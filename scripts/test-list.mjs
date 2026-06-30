// 列出 geeknow 全部图像模型 id（带重连）
const apiKey = process.argv[2]
const base = (process.env.BASE_URL || 'https://www.geeknow.top').trim().replace(/\/+$/, '').replace(/\/v1$/i, '')
async function f(url, o, n = 3) {
  for (let i = 0; i < n; i++) {
    try { return await fetch(url, o) } catch (e) { if (i === n - 1) throw e; await new Promise((r) => setTimeout(r, 700 * (i + 1))) }
  }
}
const r = await f(`${base}/v1/models`, { headers: { Authorization: `Bearer ${apiKey}` } })
const ids = ((await r.json()).data || []).map((x) => x.id)
const img = ids.filter((i) => /image|flux|dall|firefly|mj_|midjourney|seedream|nano-banana|stable|qwen-image|gemini.*image/i.test(i) && !/veo|sora|kling|runway|seedance|vidu|hailuo|video/i.test(i))
console.log('图像模型', img.length, '个：')
console.log(img.join('\n'))
