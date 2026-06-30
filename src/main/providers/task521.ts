// 521.AI（521xxz.com）异步任务接口：图片与视频都走 POST /v1/videos 提交 + GET /v1/videos/{id} 轮询。
// 图片：gpt-image-2-{1K/2K/4K} / gemini-3.1-flash-image-preview*；视频：521ai-SD(seedance) / grok-imagine-video-1.5-preview。
import { fetchWithRetry, cleanApiKey } from './openaiImage'
import { toPublicUrl, toPublicUrls } from './ossUpload'

function base521(baseURL: string): string {
  let b = (baseURL || '').trim().replace(/\/+$/, '')
  if (b.toLowerCase().endsWith('/v1')) b = b.slice(0, -3)
  // 521xxz.com 必须带 www，否则 405/436
  b = b.replace(/^https?:\/\/521xxz\.com/i, 'https://www.521xxz.com')
  return b
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// 取消机制：渲染端给每次生成一个 runId，调 cancelTask521(runId) 后轮询循环会中止
const cancelledRuns = new Set<string>()
export function cancelTask521(runId: string): void {
  if (runId) cancelledRuns.add(runId)
}
function isCancelled(runId?: string): boolean {
  if (runId && cancelledRuns.has(runId)) {
    cancelledRuns.delete(runId)
    return true
  }
  return false
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pickUrl(d: any): string {
  return (
    d?.video_url ||
    d?.url ||
    d?.output?.url ||
    d?.data?.video_url ||
    d?.data?.url ||
    d?.result?.video_url ||
    d?.result?.url ||
    (Array.isArray(d?.assets) && d.assets[0] && (d.assets[0].url || d.assets[0].video_url)) ||
    ''
  )
}

async function submitAndPoll(
  base: string,
  apiKey: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: Record<string, any>,
  onProgress?: (pct: number) => void,
  pollMs = 5000,
  maxMs = 600000,
  runId?: string
): Promise<string> {
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`, Connection: 'close' }
  if (isCancelled(runId)) throw new Error('已取消')
  console.log('[521] POST', `${base}/v1/videos`, '\n[521] payload:', JSON.stringify(payload).slice(0, 1500))
  const sub = await fetchWithRetry(`${base}/v1/videos`, { method: 'POST', headers, body: JSON.stringify(payload) })
  const subRaw = await sub.text()
  console.log('[521] submit ->', sub.status, subRaw.slice(0, 300))
  if (!sub.ok) throw new Error(`提交失败 HTTP ${sub.status} — ${subRaw.slice(0, 400)}`)
  let sj: Record<string, unknown>
  try {
    sj = JSON.parse(subRaw)
  } catch {
    throw new Error(`提交返回非 JSON：${subRaw.slice(0, 200)}`)
  }
  const taskId = String(sj.id || sj.task_id || '')
  if (!taskId) throw new Error(`提交成功但未返回 task_id：${subRaw.slice(0, 200)}`)

  const start = Date.now()
  let fails = 0
  while (Date.now() - start < maxMs) {
    await sleep(pollMs)
    if (isCancelled(runId)) throw new Error('已取消')
    let r: Response
    try {
      r = await fetchWithRetry(`${base}/v1/videos/${taskId}`, { headers })
    } catch {
      if (++fails > 8) throw new Error('轮询连续失败')
      continue
    }
    const raw = await r.text()
    if (r.status === 404) continue
    if (!r.ok) {
      if (++fails > 8) throw new Error(`轮询失败 HTTP ${r.status}`)
      continue
    }
    fails = 0
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let d: any
    try {
      d = JSON.parse(raw)
    } catch {
      continue
    }
    const status = String(d.status || d.state || '').toLowerCase()
    const prog = Math.max(0, Math.min(99, Number(d.progress) || 0))
    console.log(`[521] poll ${taskId} -> status=${status || '(空)'} progress=${prog}%`)
    if (onProgress) onProgress(prog)
    if (status === 'completed' || status === 'succeeded' || status === 'success') {
      const url = pickUrl(d)
      if (!url) throw new Error(`任务完成但无结果 URL：${raw.slice(0, 200)}`)
      console.log('[521] ✅ completed ->', url)
      if (onProgress) onProgress(100)
      return url
    }
    if (status === 'failed' || status === 'failure' || status === 'error') {
      console.log('[521] ❌ failed raw:', raw.slice(0, 600))
      const msg = d?.error?.message || d?.failure_reason || d?.message || '任务失败'
      throw new Error(String(msg))
    }
  }
  throw new Error('轮询超时，任务未完成')
}

// 比例 + 分辨率 → size（仅 16:9 / 9:16 / 1:1 能用 size，其余返回空让上游按 ratio）
function ratioToSize(ratio: string, resolution: string): string {
  const r = (resolution || '720p').toLowerCase()
  const sizes: Record<string, Record<string, string>> = {
    '16:9': { '1080p': '1920x1080', '720p': '1280x720', '480p': '854x480' },
    '9:16': { '1080p': '1080x1920', '720p': '720x1280', '480p': '480x854' },
    '1:1': { '1080p': '1080x1080', '720p': '720x720', '480p': '480x480' }
  }
  return sizes[ratio]?.[r] || sizes[ratio]?.['720p'] || ''
}

// GeekNow manxue-2.0(seedance2) 的 size 表（支持更多比例，对齐 geeknow 插件）
function geeknowSize(ratio: string, resolution: string): string {
  const r = (resolution || '720p').toLowerCase() === '480p' ? '480p' : '720p'
  const m: Record<string, Record<string, string>> = {
    '720p': { '16:9': '1280x720', '9:16': '720x1280', '1:1': '720x720', '4:3': '960x720', '3:4': '720x960', '21:9': '1680x720' },
    '480p': { '16:9': '854x480', '9:16': '480x854', '1:1': '480x480', '4:3': '640x480', '3:4': '480x640', '21:9': '1120x480' }
  }
  return m[r][ratio] || m[r]['16:9']
}

export async function task521Image(params: {
  baseURL: string
  apiKey: string
  model: string
  prompt: string
  aspectRatio?: string
  imageUrls?: string[]
  runId?: string
}): Promise<{ url: string }> {
  const base = base521(params.baseURL)
  const apiKey = cleanApiKey(params.apiKey)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payload: Record<string, any> = {
    model: params.model,
    prompt: params.prompt,
    aspect_ratio: params.aspectRatio || '1:1'
  }
  if (params.imageUrls && params.imageUrls.length) {
    // data URI 参考图先传图床换公网 URL（接口不接受 base64）
    payload.image_urls = await toPublicUrls(params.imageUrls)
  }
  const url = await submitAndPoll(base, apiKey, payload, undefined, 5000, 300000, params.runId)
  return { url }
}

// 参考图角色（对齐 521ai-SD 插件）：参考图 / 首帧 / 尾帧
export type RefRole = 'reference_image' | 'first_frame' | 'last_frame'
export interface VideoRef {
  url: string
  role: RefRole
}

export async function task521Video(
  params: {
    baseURL: string
    apiKey: string
    model: string
    prompt: string
    seconds?: number
    aspectRatio?: string
    resolution?: string
    inputReference?: string
    inputReferences?: string[]
    references?: VideoRef[] // 带角色的参考图（优先）
    generateAudio?: boolean // 生成音频
    audioUrls?: string[] // 参考音频公网 URL（最多 3，需搭配至少 1 张图）
    videoUrls?: string[] // 参考视频公网 URL（最多 3，需搭配至少 1 张图）
    runId?: string // 取消用
  },
  onProgress?: (pct: number) => void
): Promise<{ url: string }> {
  const base = base521(params.baseURL)
  const apiKey = cleanApiKey(params.apiKey)
  const ratio = params.aspectRatio || '16:9'
  const resolution = params.resolution || '720p'
  const genAudio = params.generateAudio !== false // 默认开启
  // 统一成 {url, role}：优先 references；否则把旧的 inputReferences/inputReference 当 reference_image
  const rawRefs: VideoRef[] = (
    params.references?.length
      ? params.references
      : params.inputReferences?.length
        ? params.inputReferences.map((u) => ({ url: u, role: 'reference_image' as RefRole }))
        : params.inputReference
          ? [{ url: params.inputReference, role: 'reference_image' as RefRole }]
          : []
  ).slice(0, 9) // seedance 含主图最多 9 张
  // data URI 参考图先传图床换成公网 URL（521 接口不接受 base64）
  const refs: VideoRef[] = await Promise.all(
    rawRefs.map(async (r) => ({ url: await toPublicUrl(r.url), role: r.role }))
  )
  // 参考音频 / 参考视频：data URI 也先传图床换公网 URL（各最多 3 个）
  const audioUrls = await toPublicUrls((params.audioUrls || []).filter(Boolean).slice(0, 3))
  const videoUrls = await toPublicUrls((params.videoUrls || []).filter(Boolean).slice(0, 3))
  console.log(
    `[521video] model=${params.model} ratio=${ratio} res=${resolution} ` +
      `图=${refs.length}(${refs.map((r) => r.role).join(',')}) 音频=${audioUrls.length} 视频=${videoUrls.length} 配音=${genAudio}`
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let payload: Record<string, any>
  if (/grok/i.test(params.model)) {
    // Grok：保持 video_config + reference_images（无角色 / 音频）
    payload = {
      model: params.model,
      prompt: params.prompt,
      video_config: { video_length: params.seconds || 15, aspect_ratio: ratio, resolution: 'HD' }
    }
    if (refs.length) payload.reference_images = refs.map((r) => r.url)
  } else if (/geeknow\./i.test(base)) {
    // GeekNow manxue-2.0(= seedance2.0)：content[] 格式 + @imageN 前缀 + 真实模型名 sd2_manxue_720p
    const gmodel = /manxue|seedance-?2|521ai-?sd/i.test(params.model) ? 'sd2_manxue_720p' : params.model
    const prefix = refs.length ? refs.map((_, i) => `@image${i + 1}`).join('；') + '；' : ''
    const promptText = prefix + (params.prompt || '')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const content: any[] = [{ type: 'text', text: promptText }]
    for (const r of refs) content.push({ type: 'image_url', role: r.role, image_url: { url: r.url } })
    for (const v of videoUrls) content.push({ type: 'video_url', role: 'reference_video', video_url: { url: v } })
    for (const a of audioUrls) content.push({ type: 'audio_url', role: 'reference_audio', audio_url: { url: a } })
    payload = {
      model: gmodel,
      prompt: promptText,
      content,
      size: geeknowSize(ratio, resolution),
      ratio,
      resolution: resolution === '480p' ? '480p' : '720p',
      seconds: String(params.seconds || 15),
      generate_audio: genAudio,
      seed: -1
    }
  } else {
    // 521ai-SD：简单场景走 Sora 扁平格式，多图/首尾帧/音频/视频/特殊比例走 content[] 格式
    const size = ratioToSize(ratio, resolution)
    const needContent =
      refs.length > 1 ||
      refs.some((r) => r.role !== 'reference_image') ||
      audioUrls.length > 0 ||
      videoUrls.length > 0 ||
      !size
    if (!needContent) {
      payload = {
        model: params.model,
        prompt: params.prompt,
        seconds: String(params.seconds || 5),
        resolution,
        generate_audio: genAudio
      }
      if (size) payload.size = size
      if (refs.length) payload.input_reference = refs[0].url
    } else {
      // seedance2 约定：prompt 前自动加 @image1；@image2；…（按图片顺序）让参考图生效
      const prefix = refs.length ? refs.map((_, i) => `@image${i + 1}`).join('；') + '；' : ''
      const promptText = prefix + (params.prompt || '')
      payload = {
        model: params.model,
        prompt: promptText,
        duration: Number(params.seconds || 5),
        ratio,
        resolution,
        generate_audio: genAudio
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const content: any[] = [{ type: 'text', text: promptText }]
      for (const r of refs) {
        content.push({ type: 'image_url', role: r.role, image_url: { url: r.url } })
      }
      for (const v of videoUrls) {
        content.push({ type: 'video_url', role: 'reference_video', video_url: { url: v } })
      }
      for (const a of audioUrls) {
        content.push({ type: 'audio_url', role: 'reference_audio', audio_url: { url: a } })
      }
      payload.content = content
    }
  }
  const url = await submitAndPoll(base, apiKey, payload, onProgress, 6000, 1800000, params.runId)
  return { url }
}
