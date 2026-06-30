// OpenAI 兼容文本生成适配器（/v1/chat/completions，同步）
import { fetchWithRetry, normalizeBase, cleanApiKey } from './openaiImage'

export async function generateText(params: {
  baseURL: string
  apiKey: string
  model: string
  prompt: string
}): Promise<string> {
  const base = normalizeBase(params.baseURL)
  const apiKey = cleanApiKey(params.apiKey)
  const res = await fetchWithRetry(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: params.model,
      messages: [{ role: 'user', content: params.prompt }],
      // 剧本提取常输出很长的 JSON，默认上限太低会被截断导致解析失败
      max_tokens: 8192
    })
  })
  const raw = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${raw.slice(0, 600)}`)
  const json = JSON.parse(raw)
  const content = json?.choices?.[0]?.message?.content
  if (typeof content !== 'string') {
    throw new Error(`返回结构异常：${raw.slice(0, 300)}`)
  }
  return content
}

// 视觉反推：把若干图片（视频关键帧）+ 文本一起喂给多模态对话模型，返回「文本」描述/提示词
export async function visionGenerate(params: {
  baseURL: string
  apiKey: string
  model: string
  prompt: string
  images: string[] // data:URL 或 http URL
}): Promise<string> {
  const base = normalizeBase(params.baseURL)
  const apiKey = cleanApiKey(params.apiKey)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const content: any[] = [{ type: 'text', text: params.prompt }]
  for (const img of params.images) content.push({ type: 'image_url', image_url: { url: img } })
  const res = await fetchWithRetry(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: params.model, messages: [{ role: 'user', content }], max_tokens: 4096 })
  })
  const raw = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${raw.slice(0, 600)}`)
  const json = JSON.parse(raw)
  const out = json?.choices?.[0]?.message?.content
  if (typeof out !== 'string') throw new Error(`返回结构异常：${raw.slice(0, 300)}`)
  return out
}
