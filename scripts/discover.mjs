// 用真实模型名提交，打印完整响应体 + 响应头（找轮询线索）
// 用法: node scripts/discover.mjs <apiKey> [model]
const apiKey = process.argv[2]
const model = process.argv[3] || 'GPT-Image2-1k-1x1'
const base = (process.env.BASE_URL || 'https://gongzizhao.top').replace(/\/+$/, '')

if (!apiKey) {
  console.error('用法: node scripts/discover.mjs <apiKey> [model]')
  process.exit(1)
}

console.log(`POST /v1/images/generations   model=${model}`)
const r = await fetch(`${base}/v1/images/generations`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
  body: JSON.stringify({ model, prompt: 'a corgi astronaut floating in space, cinematic', n: 1 })
})
const t = await r.text()
console.log('HTTP', r.status)
console.log('---- RESPONSE HEADERS ----')
console.log(JSON.stringify(Object.fromEntries(r.headers), null, 2))
console.log('---- RESPONSE BODY ----')
console.log(t)
