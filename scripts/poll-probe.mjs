// 探测异步任务的「查询结果」端点
// 用法: node scripts/poll-probe.mjs <apiKey> <task_id>
const apiKey = process.argv[2]
const taskId = process.argv[3]
const base = (process.env.BASE_URL || 'https://gongzizhao.top').replace(/\/+$/, '')

if (!apiKey || !taskId) {
  console.error('用法: node scripts/poll-probe.mjs <apiKey> <task_id>')
  process.exit(1)
}

const candidates = [
  `/v1/tasks/${taskId}`,
  `/v1/task/${taskId}`,
  `/v1/images/generations/${taskId}`,
  `/v1/images/tasks/${taskId}`,
  `/v1/images/generation/${taskId}`,
  `/v1/tasks?task_id=${taskId}`,
  `/v1/task?task_id=${taskId}`,
  `/v1/images/generations?task_id=${taskId}`,
  `/v1/async/tasks/${taskId}`,
  `/v1/fetch/${taskId}`
]

for (const path of candidates) {
  try {
    const r = await fetch(base + path, { headers: { Authorization: `Bearer ${apiKey}` } })
    const t = await r.text()
    const oneline = t.slice(0, 220).replace(/\s+/g, ' ')
    console.log(`${r.status}  GET ${path}\n      ${oneline}`)
  } catch (e) {
    console.log(`ERR  GET ${path}  ${e.message}`)
  }
}
