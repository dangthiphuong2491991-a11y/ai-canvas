// 视频生成适配器（geeknow / new-api 异步任务）
// 提交 POST /v1/video/generations → task_id；轮询 GET /v1/video/generations/{task_id} 直到 SUCCESS。
import { fetchWithRetry, normalizeBase } from './openaiImage'

export async function generateVideo(
  params: {
    baseURL: string
    apiKey: string
    model: string
    prompt: string
  },
  onProgress?: (pct: number) => void
): Promise<{ url: string }> {
  const base = normalizeBase(params.baseURL)

  // 1) 提交
  const subRes = await fetchWithRetry(`${base}/v1/video/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${params.apiKey}` },
    body: JSON.stringify({ model: params.model, prompt: params.prompt })
  })
  const subRaw = await subRes.text()
  if (!subRes.ok) throw new Error(`提交失败 HTTP ${subRes.status} — ${subRaw.slice(0, 300)}`)
  const sub = JSON.parse(subRaw)
  const taskId = sub.task_id || sub.id
  if (!taskId) throw new Error(`提交未返回 task_id：${subRaw.slice(0, 200)}`)

  // 2) 轮询（最多 8 分钟）
  const deadline = Date.now() + 8 * 60 * 1000
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 4000))
    let j: any
    try {
      const pRes = await fetchWithRetry(`${base}/v1/video/generations/${taskId}`, {
        headers: { Authorization: `Bearer ${params.apiKey}` }
      })
      if (!pRes.ok) continue
      j = JSON.parse(await pRes.text())
    } catch {
      continue
    }
    const d = j.data || {}
    const st = String(d.status || '').toUpperCase()
    const pct = parseInt(String(d.progress || '0').replace('%', ''), 10) || 0
    if (onProgress) onProgress(pct)
    if (st === 'SUCCESS') {
      const url = d.result_url || d.data?.video_url || d.data?.metadata?.url
      if (!url) throw new Error('任务完成但未找到视频 URL')
      return { url }
    }
    if (st.includes('FAIL')) throw new Error(`生成失败：${d.fail_reason || '未知原因'}`)
  }
  throw new Error('视频生成超时（8 分钟未完成）')
}
