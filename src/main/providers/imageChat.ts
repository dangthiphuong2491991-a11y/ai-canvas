// 多图参考生成：gemini/banana 图像模型走 /v1/chat/completions 多模态
// content = [{type:text}, {type:image_url}...]，geeknow 同步返回 { data:[{url}] }
import { fetchWithRetry, normalizeBase, cleanApiKey } from './openaiImage'

export async function imageChat(params: {
  baseURL: string
  apiKey: string
  model: string
  prompt: string
  images: string[] // data:URL 或 http URL
}): Promise<{ url?: string; b64?: string }> {
  const base = normalizeBase(params.baseURL)
  const apiKey = cleanApiKey(params.apiKey)
  const content: any[] = [{ type: 'text', text: params.prompt }]
  for (const img of params.images) content.push({ type: 'image_url', image_url: { url: img } })

  const res = await fetchWithRetry(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: params.model, messages: [{ role: 'user', content }] })
  })
  const raw = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${raw.slice(0, 500)}`)

  const j = JSON.parse(raw)
  // geeknow gemini 图像：顶层 data:[{url|b64_json}]
  if (j?.data?.[0]?.url) return { url: j.data[0].url }
  if (j?.data?.[0]?.b64_json) return { b64: j.data[0].b64_json }
  // 兜底：从全文里找图片
  const mUrl = raw.match(/https?:\/\/[^\s)"'\\]+\.(?:png|jpg|jpeg|webp)/i)
  if (mUrl) return { url: mUrl[0] }
  const mB64 = raw.match(/data:image\/[a-z]+;base64,([A-Za-z0-9+/=]+)/)
  if (mB64) return { b64: mB64[1] }
  throw new Error(`未在返回中找到图片：${raw.slice(0, 300)}`)
}
