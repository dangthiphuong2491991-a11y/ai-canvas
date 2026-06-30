// 探测 geeknow 视频接口（grok-video-1.5-pro）
// 用法: BASE_URL=https://www.geeknow.top node scripts/test-video.mjs <apiKey> [model] [prompt]
const apiKey = process.argv[2]
const model = process.argv[3] || 'grok-video-1.5-pro'
const prompt = process.argv[4] || 'a corgi astronaut floating in space, cinematic, slow motion'
const base = (process.env.BASE_URL || 'https://www.geeknow.top').trim().replace(/\/+$/, '').replace(/\/v1$/i, '')

if (!apiKey) {
  console.error('用法: node scripts/test-video.mjs <apiKey> [model] [prompt]')
  process.exit(1)
}

console.log(`中转站: ${base}  model=${model}`)
console.log('—'.repeat(50))

// ① 模型列表里和视频/grok 相关的
console.log('① GET /v1/models（视频相关）')
try {
  const r = await fetch(`${base}/v1/models`, { headers: { Authorization: `Bearer ${apiKey}` } })
  const t = await r.text()
  if (r.ok) {
    const ids = (JSON.parse(t).data || []).map((x) => x.id)
    const vids = ids.filter((i) => /grok-?video|veo|sora|kling|runway|seedance|vidu|hailuo|video/i.test(i))
    console.log(`   命中 ${vids.length} 个：`, vids.slice(0, 30).join(', '))
    console.log('   目标模型存在:', ids.includes(model))
  } else {
    console.log('   HTTP', r.status, t.slice(0, 200))
  }
} catch (e) {
  console.log('   异常:', e.message)
}

// ② 提交：POST /v1/video/generations
console.log('\n② POST /v1/video/generations  提交')
const ctrl = new AbortController()
const to = setTimeout(() => ctrl.abort(), 150000)
try {
  const r = await fetch(`${base}/v1/video/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, prompt }),
    signal: ctrl.signal
  })
  clearTimeout(to)
  const t = await r.text()
  console.log('   HTTP', r.status)
  console.log('   HEADERS', JSON.stringify(Object.fromEntries(r.headers)))
  console.log('   BODY', t.slice(0, 1800))
} catch (e) {
  clearTimeout(to)
  console.log('   提交异常/超时:', e.message, '（超时多半说明是同步长请求）')
}
