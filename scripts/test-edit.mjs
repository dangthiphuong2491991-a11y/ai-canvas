// 图生图(/v1/images/edits)联调脚本
// 用法: BASE_URL=https://www.geeknow.top node scripts/test-edit.mjs <apiKey> [model] [prompt] [imgPath]
import { writeFileSync, readFileSync } from 'node:fs'

const apiKey = process.argv[2]
const model = process.argv[3] || 'gpt-image-2'
const prompt = process.argv[4] || '把背景换成晴朗的蓝天白云草地，柴犬戴上一副黑色墨镜'
const imgPath = process.argv[5] || 'test-output.png'
const base = (process.env.BASE_URL || 'https://www.geeknow.top')
  .trim()
  .replace(/\/+$/, '')
  .replace(/\/v1$/i, '')

if (!apiKey) {
  console.error('用法: node scripts/test-edit.mjs <apiKey> [model] [prompt] [imgPath]')
  process.exit(1)
}

async function fetchWithRetry(url, options, attempts = 3) {
  let lastErr
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetch(url, options)
    } catch (e) {
      lastErr = e
      const msg = String(e?.cause?.code || e?.cause?.message || e?.message || e)
      const retriable =
        /UND_ERR_SOCKET|ECONNRESET|other side closed|ECONNREFUSED|ETIMEDOUT|EPIPE|terminated|socket hang up/i.test(
          msg
        )
      if (!retriable || i === attempts - 1) throw e
      await new Promise((r) => setTimeout(r, 800 * (i + 1)))
    }
  }
  throw lastErr
}

const buf = readFileSync(imgPath)
console.log(`图生图: ${base}/v1/images/edits  model=${model}  参考图=${imgPath}(${buf.length} bytes)`)

const form = new FormData()
form.append('model', model)
form.append('prompt', prompt)
form.append('n', '1')
form.append('image', new Blob([buf], { type: 'image/png' }), 'image.png')

const res = await fetchWithRetry(`${base}/v1/images/edits`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${apiKey}` },
  body: form
})
const text = await res.text()
console.log('HTTP', res.status)
if (!res.ok) {
  console.log('❌ 错误:', text.slice(0, 900))
  process.exit(1)
}
const item = (JSON.parse(text).data || [])[0]
if (!item) {
  console.log('❌ 无 data:', text.slice(0, 400))
  process.exit(1)
}
if (item.b64_json) {
  writeFileSync('test-edit-output.png', Buffer.from(item.b64_json, 'base64'))
  console.log('✅ 已保存 test-edit-output.png (b64_json)')
} else if (item.url) {
  console.log('✅ 返回 URL:', item.url)
  const img = await fetchWithRetry(item.url, {})
  writeFileSync('test-edit-output.png', Buffer.from(await img.arrayBuffer()))
  console.log('已下载到 test-edit-output.png')
}
