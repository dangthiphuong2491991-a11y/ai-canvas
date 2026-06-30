// 探测多图参考编辑（/v1/images/edits 传 2 张图）
// 用法: BASE_URL=https://www.geeknow.top node scripts/test-multiref.mjs <apiKey> [model]
import { readFileSync } from 'node:fs'
const apiKey = process.argv[2]
let model = process.argv[3]
const base = (process.env.BASE_URL || 'https://www.geeknow.top').trim().replace(/\/+$/, '').replace(/\/v1$/i, '')

if (!apiKey) {
  console.error('用法: node scripts/test-multiref.mjs <apiKey> [model]')
  process.exit(1)
}

// 1) 找候选模型
const lr = await fetch(`${base}/v1/models`, { headers: { Authorization: `Bearer ${apiKey}` } })
const ids = ((await lr.json()).data || []).map((x) => x.id)
const banana = ids.filter((i) => /banana/i.test(i))
const gem = ids.filter((i) => /gemini.*image/i.test(i))
console.log('banana 系:', banana.join(', ') || '(无)')
console.log('gemini-image 系:', gem.slice(0, 12).join(', ') || '(无)')
if (!model) model = banana[0] || gem[0] || 'gemini-2.5-flash-image'
console.log('本次用模型:', model)
console.log('—'.repeat(50))

// 2) 传两张图做多图编辑
const form = new FormData()
form.append('model', model)
form.append('prompt', '把这两个角色放进同一个场景，保持各自画风，全身站立')
form.append('n', '1')
const a = readFileSync('test-output.png')
const b = readFileSync('test-edit-output.png')
form.append('image', new Blob([a], { type: 'image/png' }), 'a.png')
form.append('image', new Blob([b], { type: 'image/png' }), 'b.png')

console.log('POST /v1/images/edits  （2 张 image 字段）')
const res = await fetch(`${base}/v1/images/edits`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${apiKey}` },
  body: form
})
const t = await res.text()
console.log('HTTP', res.status)
console.log(t.slice(0, 700))
