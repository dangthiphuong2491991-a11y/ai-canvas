// 探测 geeknow 是否有放大/去背景等后处理模型
// 用法: node scripts/test-tools.mjs <apiKey>
const apiKey = process.argv[2]
const base = (process.env.BASE_URL || 'https://www.geeknow.top').trim().replace(/\/+$/, '').replace(/\/v1$/i, '')
if (!apiKey) {
  console.error('用法: node scripts/test-tools.mjs <apiKey>')
  process.exit(1)
}
const r = await fetch(`${base}/v1/models`, { headers: { Authorization: `Bearer ${apiKey}` } })
const ids = ((await r.json()).data || []).map((x) => x.id)
const m = (re) => ids.filter((i) => re.test(i))
console.log('总模型数:', ids.length)
console.log('放大/超分:', m(/upscal|esrgan|clarity|super.?res|gigapixel|recraft.*(upscale|crisp)|magnific|topaz|hd-?2/i).join(', ') || '(无)')
console.log('去背景/抠图:', m(/remove.?bg|rembg|background.?remov|cutout|matting|bria|抠图|去背/i).join(', ') || '(无)')
console.log('编辑/重绘:', m(/edit|inpaint|outpaint|fill|erase|kontext/i).slice(0, 20).join(', ') || '(无)')
console.log('recraft:', m(/recraft/i).join(', ') || '(无)')
console.log('flux:', m(/flux/i).slice(0, 15).join(', ') || '(无)')
console.log('ideogram:', m(/ideogram/i).join(', ') || '(无)')
