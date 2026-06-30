// 轮询视频任务直到完成，打印完整结构（找 URL 字段）
const apiKey = process.argv[2]
const taskId = process.argv[3]
const base = (process.env.BASE_URL || 'https://www.geeknow.top').trim().replace(/\/+$/, '').replace(/\/v1$/i, '')

for (let i = 0; i < 16; i++) {
  const r = await fetch(`${base}/v1/video/generations/${taskId}`, { headers: { Authorization: `Bearer ${apiKey}` } })
  const j = await r.json()
  const d = j.data || {}
  console.log(`poll ${i}: status=${d.status} progress=${d.progress}`)
  if (d.status && /SUCCESS|FAIL|COMPLETE|FINISH/i.test(d.status)) {
    console.log('==== FINAL ====')
    console.log(JSON.stringify(j, null, 2))
    break
  }
  await new Promise((s) => setTimeout(s, 12000))
}
