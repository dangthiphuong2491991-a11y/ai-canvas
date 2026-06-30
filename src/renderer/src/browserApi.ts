// 浏览器/开发回退：在没有 Electron 预加载(window.api)的环境（纯浏览器打开 dev server）里，
// 直接 fetch 中转站，让界面在浏览器里也能真实生成（geeknow 等中转站允许跨域）。
// Electron 内运行时 window.api 已存在，本文件不生效。

function normalizeBase(baseURL: string): string {
  let b = (baseURL || '').trim().replace(/\/+$/, '')
  if (b.toLowerCase().endsWith('/v1')) b = b.slice(0, -3)
  return b
}

// 取消机制（浏览器回退）
const _cancelledRuns = new Set<string>()
function _isCancelled(runId?: string): boolean {
  if (runId && _cancelledRuns.has(runId)) {
    _cancelledRuns.delete(runId)
    return true
  }
  return false
}

// 给请求加超时，避免中转站卡住时节点一直 loading（默认 150s，足够长视频/出图，又不至于无限等）
async function fetchRetry(url: string, opts: RequestInit, n = 3, timeoutMs = 150000): Promise<Response> {
  let last: unknown
  for (let i = 0; i < n; i++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      return await fetch(url, { ...opts, signal: ctrl.signal })
    } catch (e) {
      last = e
      const msg = String((e as Error)?.message || e)
      // 超时不重试（再试也大概率慢）；网络抖动才重试
      if (/abort/i.test(msg)) throw new Error(`请求超时（${Math.round(timeoutMs / 1000)}秒未响应），中转站可能繁忙，请稍后重试`)
      if (i === n - 1) throw e
      await new Promise((r) => setTimeout(r, 800 * (i + 1)))
    } finally {
      clearTimeout(timer)
    }
  }
  throw last
}

function cleanKey(k: string): string {
  const key = (k || '').trim()
  if (!key) throw new Error('未填写 API 密钥，请到设置里填入')
  // eslint-disable-next-line no-control-regex
  if (!/^[\x20-\x7E]+$/.test(key)) {
    throw new Error('API 密钥含非法字符（常见原因：把掩码显示的圆点 ● 复制进来了）。请到设置里重新粘贴真实密钥（如 sk-…）')
  }
  return key
}

const auth = (k: string): Record<string, string> => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${cleanKey(k)}`
})

interface GenItem {
  b64?: string
  url?: string
}

const browserApi = {
  async textGenerate(p: { baseURL: string; apiKey: string; model: string; prompt: string }): Promise<string> {
    const res = await fetchRetry(`${normalizeBase(p.baseURL)}/v1/chat/completions`, {
      method: 'POST',
      headers: auth(p.apiKey),
      body: JSON.stringify({ model: p.model, messages: [{ role: 'user', content: p.prompt }], max_tokens: 8192 })
    })
    const raw = await res.text()
    if (!res.ok) throw new Error(`HTTP ${res.status} — ${raw.slice(0, 600)}`)
    const c = JSON.parse(raw)?.choices?.[0]?.message?.content
    if (typeof c !== 'string') throw new Error(`返回结构异常：${raw.slice(0, 300)}`)
    return c
  },

  async visionGenerate(p: {
    baseURL: string
    apiKey: string
    model: string
    prompt: string
    images: string[]
  }): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const content: any[] = [{ type: 'text', text: p.prompt }]
    for (const img of p.images) content.push({ type: 'image_url', image_url: { url: img } })
    const res = await fetchRetry(`${normalizeBase(p.baseURL)}/v1/chat/completions`, {
      method: 'POST',
      headers: auth(p.apiKey),
      body: JSON.stringify({ model: p.model, messages: [{ role: 'user', content }], max_tokens: 4096 })
    })
    const raw = await res.text()
    if (!res.ok) throw new Error(`HTTP ${res.status} — ${raw.slice(0, 600)}`)
    const c = JSON.parse(raw)?.choices?.[0]?.message?.content
    if (typeof c !== 'string') throw new Error(`返回结构异常：${raw.slice(0, 300)}`)
    return c
  },

  async generateImage(p: {
    baseURL: string
    apiKey: string
    model: string
    prompt: string
    size?: string
    n?: number
  }): Promise<GenItem[]> {
    const body: Record<string, unknown> = { model: p.model, prompt: p.prompt, n: p.n ?? 1 }
    if (p.size && p.size !== 'auto') body.size = p.size
    const res = await fetchRetry(`${normalizeBase(p.baseURL)}/v1/images/generations`, {
      method: 'POST',
      headers: auth(p.apiKey),
      body: JSON.stringify(body)
    })
    const raw = await res.text()
    if (!res.ok) throw new Error(`HTTP ${res.status} — ${raw.slice(0, 600)}`)
    const j = JSON.parse(raw)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (j.data || []).map((d: any) => ({ b64: d.b64_json, url: d.url }))
  },

  async imageChat(p: {
    baseURL: string
    apiKey: string
    model: string
    prompt: string
    images: string[]
  }): Promise<GenItem> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const content: any[] = [{ type: 'text', text: p.prompt }]
    for (const img of p.images) content.push({ type: 'image_url', image_url: { url: img } })
    const res = await fetchRetry(`${normalizeBase(p.baseURL)}/v1/chat/completions`, {
      method: 'POST',
      headers: auth(p.apiKey),
      body: JSON.stringify({ model: p.model, messages: [{ role: 'user', content }] })
    })
    const raw = await res.text()
    if (!res.ok) throw new Error(`HTTP ${res.status} — ${raw.slice(0, 500)}`)
    const j = JSON.parse(raw)
    if (j?.data?.[0]?.url) return { url: j.data[0].url }
    if (j?.data?.[0]?.b64_json) return { b64: j.data[0].b64_json }
    const mUrl = raw.match(/https?:\/\/[^\s)"'\\]+\.(?:png|jpg|jpeg|webp)/i)
    if (mUrl) return { url: mUrl[0] }
    const mB64 = raw.match(/data:image\/[a-z]+;base64,([A-Za-z0-9+/=]+)/)
    if (mB64) return { b64: mB64[1] }
    throw new Error(`未在返回中找到图片：${raw.slice(0, 300)}`)
  },

  // 521.AI 异步任务：提交 /v1/videos + 轮询 /v1/videos/{id}（图片与视频通用）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  task521Cancel(runId: string): void {
    if (runId) _cancelledRuns.add(runId)
  },

  async _task521(p: { baseURL: string; apiKey: string; runId?: string }, payload: Record<string, any>, maxMs: number): Promise<{ url: string }> {
    let b = normalizeBase(p.baseURL).replace(/^https?:\/\/521xxz\.com/i, 'https://www.521xxz.com')
    const headers = auth(p.apiKey)
    if (_isCancelled(p.runId)) throw new Error('已取消')
    const sub = await fetchRetry(`${b}/v1/videos`, { method: 'POST', headers, body: JSON.stringify(payload) })
    const subRaw = await sub.text()
    if (!sub.ok) throw new Error(`提交失败 HTTP ${sub.status} — ${subRaw.slice(0, 300)}`)
    const sj = JSON.parse(subRaw)
    const id = sj.id || sj.task_id
    if (!id) throw new Error('未返回 task_id')
    const start = Date.now()
    while (Date.now() - start < maxMs) {
      await new Promise((r) => setTimeout(r, 5000))
      if (_isCancelled(p.runId)) throw new Error('已取消')
      const r = await fetchRetry(`${b}/v1/videos/${id}`, { headers })
      if (r.status === 404) continue
      const raw = await r.text()
      if (!r.ok) continue
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let d: any
      try { d = JSON.parse(raw) } catch { continue }
      const st = String(d.status || d.state || '').toLowerCase()
      if (st === 'completed' || st === 'succeeded' || st === 'success') {
        const url = d.video_url || d.url || d.output?.url || ''
        if (!url) throw new Error('完成但无 URL')
        return { url }
      }
      if (st === 'failed' || st === 'error') throw new Error(d?.error?.message || d?.failure_reason || '任务失败')
    }
    throw new Error('轮询超时')
  },

  async task521Image(p: {
    baseURL: string; apiKey: string; model: string; prompt: string; aspectRatio?: string; imageUrls?: string[]
  }): Promise<{ url: string }> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload: Record<string, any> = { model: p.model, prompt: p.prompt, aspect_ratio: p.aspectRatio || '1:1' }
    if (p.imageUrls && p.imageUrls.length) payload.image_urls = p.imageUrls
    return this._task521(p, payload, 300000)
  },

  async task521Video(p: {
    baseURL: string; apiKey: string; model: string; prompt: string; seconds?: number; aspectRatio?: string; resolution?: string; inputReference?: string; inputReferences?: string[]; references?: { url: string; role: 'reference_image' | 'first_frame' | 'last_frame' }[]; generateAudio?: boolean; audioUrls?: string[]; videoUrls?: string[]
  }): Promise<{ url: string }> {
    const ratio = p.aspectRatio || '16:9'
    const resolution = p.resolution || '720p'
    const genAudio = p.generateAudio !== false
    const refs = p.references?.length
      ? p.references
      : p.inputReferences?.length
        ? p.inputReferences.map((u) => ({ url: u, role: 'reference_image' as const }))
        : p.inputReference
          ? [{ url: p.inputReference, role: 'reference_image' as const }]
          : []
    const audioUrls = (p.audioUrls || []).filter(Boolean).slice(0, 3)
    const videoUrls = (p.videoUrls || []).filter(Boolean).slice(0, 3)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let payload: Record<string, any>
    if (/grok/i.test(p.model)) {
      payload = { model: p.model, prompt: p.prompt, video_config: { video_length: p.seconds || 15, aspect_ratio: ratio, resolution: 'HD' } }
      if (refs.length) payload.reference_images = refs.map((r) => r.url)
    } else {
      const size = ratio === '16:9' ? (resolution === '480p' ? '854x480' : '1280x720') : ratio === '9:16' ? (resolution === '480p' ? '480x854' : '720x1280') : ratio === '1:1' ? (resolution === '480p' ? '480x480' : '720x720') : ''
      const needContent = refs.length > 1 || refs.some((r) => r.role !== 'reference_image') || audioUrls.length > 0 || videoUrls.length > 0 || !size
      if (!needContent) {
        payload = { model: p.model, prompt: p.prompt, seconds: String(p.seconds || 5), resolution, generate_audio: genAudio }
        if (size) payload.size = size
        if (refs.length) payload.input_reference = refs[0].url
      } else {
        const prefix = refs.length ? refs.map((_, i) => `@image${i + 1}`).join('；') + '；' : ''
        const promptText = prefix + (p.prompt || '')
        payload = { model: p.model, prompt: promptText, duration: Number(p.seconds || 5), ratio, resolution, generate_audio: genAudio }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const content: any[] = [{ type: 'text', text: promptText }]
        for (const r of refs) content.push({ type: 'image_url', role: r.role, image_url: { url: r.url } })
        for (const v of videoUrls) content.push({ type: 'video_url', role: 'reference_video', video_url: { url: v } })
        for (const a of audioUrls) content.push({ type: 'audio_url', role: 'reference_audio', audio_url: { url: a } })
        payload.content = content
      }
    }
    return this._task521(p, payload, 1800000)
  },

  async listModels(p: { baseURL: string; apiKey: string }): Promise<string[]> {
    const res = await fetchRetry(`${normalizeBase(p.baseURL)}/v1/models`, { headers: auth(p.apiKey) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const j = JSON.parse(await res.text())
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (j.data || []).map((m: any) => m.id).filter(Boolean)
  },

  async saveImage(p: { b64?: string; url?: string; defaultName?: string }): Promise<{ ok: boolean }> {
    const href = p.b64 ? `data:image/png;base64,${p.b64}` : p.url || ''
    if (!href) return { ok: false }
    const a = document.createElement('a')
    a.href = href
    a.download = p.defaultName || 'image.png'
    a.click()
    return { ok: true }
  },

  // 浏览器回退不支持视频轮询进度
  async videoGenerate(): Promise<{ url: string }> {
    throw new Error('浏览器回退模式暂不支持视频生成，请在桌面应用里使用')
  },
  onVideoProgress(): () => void {
    return () => {}
  },
  async editImage(): Promise<GenItem[]> {
    throw new Error('浏览器回退模式暂不支持图生图编辑，请在桌面应用里使用')
  }
}

// 仅在没有 Electron 预加载时安装
export function installBrowserApiFallback(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any
  if (!w.api) {
    w.api = browserApi
    w.__browserApi = true
    // eslint-disable-next-line no-console
    console.info('[ai-canvas] 使用浏览器直连回退（无 Electron 预加载）')
  }
}
