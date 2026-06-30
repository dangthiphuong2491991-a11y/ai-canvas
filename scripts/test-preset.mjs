// 测试后处理预设（去背景/放大）via gemini chat 多模态
// 用法: node scripts/test-preset.mjs <apiKey> [prompt] [img]
import { readFileSync, writeFileSync } from 'node:fs'
const apiKey = process.argv[2]
const prompt = process.argv[3] || '移除图片背景，只保留主体，背景替换为纯白色'
const img = process.argv[4] || 'test-output.png'
const base = (process.env.BASE_URL || 'https://www.geeknow.top').trim().replace(/\/+$/, '').replace(/\/v1$/i, '')
const b64 = readFileSync(img).toString('base64')
const body = {
  model: 'gemini-2.5-flash-image',
  messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } }] }]
}
const r = await fetch(`${base}/v1/chat/completions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
  body: JSON.stringify(body)
})
const t = await r.text()
console.log('HTTP', r.status)
if (!r.ok) { console.log(t.slice(0, 500)); process.exit(1) }
const j = JSON.parse(t)
const url = j.data?.[0]?.url || (t.match(/https?:\/\/[^\s"'\\]+\.(?:png|jpg|jpeg|webp)/i) || [])[0]
if (url) {
  console.log('结果 URL:', url)
  const im = await fetch(url)
  writeFileSync('test-preset-output.png', Buffer.from(await im.arrayBuffer()))
  console.log('已保存 test-preset-output.png')
} else {
  console.log('未找到图片:', t.slice(0, 400))
}
