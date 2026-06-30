// 探测视频任务轮询端点
// 用法: BASE_URL=https://www.geeknow.top node scripts/test-video-poll.mjs <apiKey> <task_id>
const apiKey = process.argv[2]
const taskId = process.argv[3]
const base = (process.env.BASE_URL || 'https://www.geeknow.top').trim().replace(/\/+$/, '').replace(/\/v1$/i, '')

if (!apiKey || !taskId) {
  console.error('用法: node scripts/test-video-poll.mjs <apiKey> <task_id>')
  process.exit(1)
}

const candidates = [
  `/v1/video/generations/${taskId}`,
  `/v1/videos/${taskId}`,
  `/v1/video/generations?task_id=${taskId}`,
  `/v1/video/generation/${taskId}`,
  `/v1/video/generations/${taskId}/fetch`,
  `/v1/tasks/${taskId}`
]

for (const path of candidates) {
  try {
    const r = await fetch(base + path, { headers: { Authorization: `Bearer ${apiKey}` } })
    const t = await r.text()
    console.log(`${r.status}  GET ${path}\n      ${t.slice(0, 260).replace(/\s+/g, ' ')}`)
  } catch (e) {
    console.log(`ERR  GET ${path}  ${e.message}`)
  }
}
