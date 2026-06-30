// OpenAI 兼容图像生成/编辑适配器
// 适用于所有 New API / One API 系的中转站（geeknow.top 等）。
// 换中转站只需改 baseURL + apiKey，这里的逻辑不用动。

export interface ImageGenParams {
  baseURL: string
  apiKey: string
  model: string
  prompt: string
  size?: string
  n?: number
}

export interface ImageEditParams extends ImageGenParams {
  /** 参考图：可以是 data:URL 或 http(s) URL */
  imageSrc: string
}

export interface GenResultItem {
  b64?: string
  url?: string
}

/** 容错处理 baseURL：去掉结尾斜杠，去掉用户可能多填的 /v1 */
export function normalizeBase(baseURL: string): string {
  let b = baseURL.trim().replace(/\/+$/, '')
  if (b.toLowerCase().endsWith('/v1')) b = b.slice(0, -3)
  return b
}

// 校验并清理 API 密钥：HTTP 头只能是 ASCII，非法字符（如误粘贴的掩码圆点 ●）会让 fetch 直接崩，
// 这里提前给出可读错误。
export function cleanApiKey(key: string): string {
  const k = (key || '').trim()
  if (!k) throw new Error('未填写 API 密钥，请到设置里填入')
  // eslint-disable-next-line no-control-regex
  if (!/^[\x20-\x7E]+$/.test(k)) {
    throw new Error('API 密钥含非法字符（常见原因：把掩码显示的圆点 ● 复制进来了）。请到设置里重新粘贴真实密钥（如 sk-…）')
  }
  return k
}

/**
 * 带自动重连的 fetch。
 * 中转站生图常要 30~120 秒，期间 undici 复用的 keep-alive 连接可能被服务器关闭，
 * 抛出 "other side closed" / ECONNRESET。这类连接层错误重试即可（会新建连接）。
 */
export async function fetchWithRetry(
  url: string,
  options: RequestInit,
  attempts = 3,
  timeoutMs = 150000
): Promise<Response> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      return await fetch(url, { ...options, signal: ctrl.signal })
    } catch (e) {
      lastErr = e
      const msg = String(
        (e as any)?.cause?.code || (e as any)?.cause?.message || (e as Error)?.message || e
      )
      // 超时：中转站长时间无响应，不再重试，直接给清晰错误（避免节点无限 loading）
      if (/abort/i.test(msg)) {
        throw new Error(`请求超时（${Math.round(timeoutMs / 1000)}秒未响应），中转站可能繁忙，请稍后重试`)
      }
      const retriable =
        /UND_ERR_SOCKET|ECONNRESET|other side closed|ECONNREFUSED|ETIMEDOUT|EPIPE|terminated|socket hang up/i.test(
          msg
        )
      if (!retriable || i === attempts - 1) throw e
      await new Promise((r) => setTimeout(r, 800 * (i + 1)))
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastErr
}

/** 解析 OpenAI 图像接口的统一返回（generations / edits 通用） */
async function parseImageResponse(res: Response): Promise<GenResultItem[]> {
  const raw = await res.text()
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} — ${raw.slice(0, 600)}`)
  }
  let json: any
  try {
    json = JSON.parse(raw)
  } catch {
    throw new Error(`返回非 JSON：${raw.slice(0, 300)}`)
  }
  if (!json.data || !Array.isArray(json.data)) {
    throw new Error(`返回结构异常：${JSON.stringify(json).slice(0, 400)}`)
  }
  return json.data.map((d: any) => ({ b64: d.b64_json, url: d.url }))
}

/** data:URL 或 http URL → 图片二进制 */
async function srcToBuffer(src: string): Promise<Buffer> {
  if (src.startsWith('data:')) {
    const b64 = src.split(',')[1] ?? ''
    return Buffer.from(b64, 'base64')
  }
  const res = await fetchWithRetry(src, {})
  if (!res.ok) throw new Error(`读取参考图失败 HTTP ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

/** 文生图 */
export async function generateImage(params: ImageGenParams): Promise<GenResultItem[]> {
  const base = normalizeBase(params.baseURL)
  const apiKey = cleanApiKey(params.apiKey)
  const body: Record<string, unknown> = {
    model: params.model,
    prompt: params.prompt,
    n: params.n ?? 1
  }
  if (params.size && params.size !== 'auto') body.size = params.size

  const res = await fetchWithRetry(`${base}/v1/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  })
  return parseImageResponse(res)
}

/** 图生图 / 参考图编辑（multipart 上传参考图） */
export async function editImage(params: ImageEditParams): Promise<GenResultItem[]> {
  const base = normalizeBase(params.baseURL)
  const apiKey = cleanApiKey(params.apiKey)
  const form = new FormData()
  form.append('model', params.model)
  form.append('prompt', params.prompt)
  form.append('n', String(params.n ?? 1))
  if (params.size && params.size !== 'auto') form.append('size', params.size)

  const buf = await srcToBuffer(params.imageSrc)
  form.append('image', new Blob([buf], { type: 'image/png' }), 'image.png')

  // 注意：multipart 不要手动设 Content-Type，让 fetch 自动带 boundary
  const res = await fetchWithRetry(`${base}/v1/images/edits`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form
  })
  return parseImageResponse(res)
}

/** 拉取该渠道支持的模型列表（New API 系都支持 /v1/models） */
export async function listModels(params: {
  baseURL: string
  apiKey: string
}): Promise<string[]> {
  const base = normalizeBase(params.baseURL)
  const res = await fetchWithRetry(`${base}/v1/models`, {
    headers: { Authorization: `Bearer ${params.apiKey}` }
  })
  const raw = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${raw.slice(0, 300)}`)
  const json = JSON.parse(raw)
  return (json.data || []).map((m: any) => m.id).filter(Boolean)
}

/** 主进程下载图片 URL → base64（绕开渲染层跨域，便于内嵌画布/持久化） */
export async function downloadToBase64(url: string): Promise<string> {
  const res = await fetchWithRetry(url, {})
  if (!res.ok) throw new Error(`下载图片失败 HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  return buf.toString('base64')
}
