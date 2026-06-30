// 探测 gemini 图像多图融合（chat-completions 多模态）
// 用法: BASE_URL=https://www.geeknow.top node scripts/test-gemini-multi.mjs <apiKey> [model]
import { readFileSync, writeFileSync } from 'node:fs'
const apiKey = process.argv[2]
const model = process.argv[3] || 'gemini-2.5-flash-image'
const base = (process.env.BASE_URL || 'https://www.geeknow.top').trim().replace(/\/+$/, '').replace(/\/v1$/i, '')

const a = readFileSync('test-output.png').toString('base64')
const b = readFileSync('test-edit-output.png').toString('base64')

const body = {
  model,
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: '把这两个角色合成到同一张图里，同一场景，保持各自画风' },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${a}` } },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${b}` } }
      ]
    }
  ]
}

console.log(`POST /v1/chat/completions  model=${model}（多模态 2 图）`)
const res = await fetch(`${base}/v1/chat/completions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
  body: JSON.stringify(body)
})
const t = await res.text()
console.log('HTTP', res.status)
if (!res.ok) {
  console.log(t.slice(0, 800))
  process.exit(1)
}
const j = JSON.parse(t)
// 结构化看顶层 + choices[0] 的所有键，并定位图片
const top = { ...j }
delete top.choices
console.log('顶层(除 choices):', JSON.stringify(top).slice(0, 500))
const ch0 = j.choices?.[0] || {}
console.log('choices[0] keys:', Object.keys(ch0))
console.log('choices[0]:', JSON.stringify(ch0).slice(0, 900))
// 全文找图片 url / base64
const mUrl = t.match(/https?:\/\/[^\s)"'\\]+\.(?:png|jpg|jpeg|webp)/i)
const mB64 = t.match(/data:image\/[a-z]+;base64,([A-Za-z0-9+/=]+)/)
if (mUrl) console.log('✅ 图片 URL:', mUrl[0])
if (mB64) {
  writeFileSync('test-multi-output.png', Buffer.from(mB64[1], 'base64'))
  console.log('✅ 内联 base64 → test-multi-output.png  (len', mB64[1].length, ')')
}
if (!mUrl && !mB64) console.log('⚠ 没找到图片。原始前 1500 字:', t.slice(0, 1500))
