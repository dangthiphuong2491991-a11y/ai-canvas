// 中转站生图联调脚本（命令行直接验证，不用先开 App）
// 用法:
//   node scripts/test-gen.mjs <apiKey> [model] [prompt]
// 例:
//   BASE_URL=https://www.geeknow.top node scripts/test-gen.mjs sk-xxxx gpt-image-2 "a corgi astronaut"

import { writeFileSync } from 'node:fs'

const apiKey = process.argv[2]
const model = process.argv[3] || 'gpt-image-2'
const prompt = process.argv[4] || '一只穿着宇航服的柴犬，漂浮在星空中，电影感，高细节'
const baseURL = process.env.BASE_URL || 'https://www.geeknow.top'

if (!apiKey) {
  console.error('用法: node scripts/test-gen.mjs <apiKey> [model] [prompt]')
  process.exit(1)
}

const base = baseURL.trim().replace(/\/+$/, '').replace(/\/v1$/i, '')

// 与正式适配器同款：socket 类错误自动重连
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
      console.log(`   ⚠ 第 ${i + 1} 次请求失败(${msg})${retriable && i < attempts - 1 ? '，重连…' : ''}`)
      if (!retriable || i === attempts - 1) throw e
      await new Promise((r) => setTimeout(r, 800 * (i + 1)))
    }
  }
  throw lastErr
}

console.log(`中转站: ${base}`)
console.log('—'.repeat(50))

// 1) 拉模型列表
console.log('① GET /v1/models')
{
  const r = await fetchWithRetry(`${base}/v1/models`, {
    headers: { Authorization: `Bearer ${apiKey}` }
  })
  const t = await r.text()
  console.log('   HTTP', r.status)
  if (r.ok) {
    const ids = (JSON.parse(t).data || []).map((x) => x.id)
    const imgs = ids.filter((i) => /image|flux|sd|dall|firefly|mj|seedream|gemini/i.test(i))
    console.log(`   共 ${ids.length} 个模型；图像相关 ${imgs.length} 个，示例:`)
    console.log('   ', imgs.slice(0, 25).join(', '))
  } else {
    console.log('   ', t.slice(0, 300))
  }
}

// 2) 生图
console.log(`\n② POST /v1/images/generations   model=${model}（可能要 30~120 秒）`)
const res = await fetchWithRetry(`${base}/v1/images/generations`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
  body: JSON.stringify({ model, prompt, n: 1 })
})
const text = await res.text()
console.log('   HTTP', res.status)
if (!res.ok) {
  console.log('   ❌ 错误:', text.slice(0, 800))
  process.exit(1)
}

const json = JSON.parse(text)
const item = (json.data || [])[0]
if (!item) {
  console.log('   ❌ 返回无 data:', JSON.stringify(json).slice(0, 400))
  process.exit(1)
}

if (item.b64_json) {
  writeFileSync('test-output.png', Buffer.from(item.b64_json, 'base64'))
  console.log('   ✅ 已保存 test-output.png (来自 b64_json)')
} else if (item.url) {
  console.log('   ✅ 返回图片 URL:', item.url)
  const img = await fetchWithRetry(item.url, {})
  writeFileSync('test-output.png', Buffer.from(await img.arrayBuffer()))
  console.log('   已下载到 test-output.png')
} else {
  console.log('   ⚠ 未知返回结构:', JSON.stringify(item).slice(0, 300))
}
