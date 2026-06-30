// 测试剧本→人物提取（chat completions + 内置提示词 → 解析 JSON）
const apiKey = process.argv[2]
const model = process.argv[3] || 'gemini-2.5-flash'
const base = (process.env.BASE_URL || 'https://www.geeknow.top').trim().replace(/\/+$/, '').replace(/\/v1$/i, '')

const SCRIPT = `
夜晚的赛博朋克都市。
林夏，22岁女黑客，染着蓝色短发，穿破洞机能外套，眼神锐利，手腕上有发光的义体。
老陈，50岁，前警探，络腮胡，灰色风衣，疲惫但坚毅，叼着电子烟。
机器人 K-9，银白色流线机身，单眼红色光学传感器，行动敏捷。
`

const CUSTOM = '统一日系动漫画风、全身立绘、白色背景'
const PROMPT =
  '你是专业的影视/游戏概念设计助手。阅读下面的剧本/故事，提取需要绘制概念图的元素，分三类：\n' +
  '- 场景：重要的环境、地点\n- 人物：所有出场角色\n- 道具：关键物件、装备、载具\n' +
  '为每个元素写一段高质量的「文生图」提示词。\n' +
  '额外要求（务必遵守）：' + CUSTOM + '\n' +
  '严格只返回一个 JSON 数组，每项形如 {"type":"场景|人物|道具","name":"名称","prompt":"提示词"}。不要解释、不要 markdown 代码块。\n' +
  '剧本：\n"""\n' + SCRIPT + '\n"""'

async function f(url, o, n = 3) {
  for (let i = 0; i < n; i++) {
    try { return await fetch(url, o) } catch (e) { if (i === n - 1) throw e; await new Promise((r) => setTimeout(r, 700 * (i + 1))) }
  }
}

console.log('提取模型:', model)
const r = await f(`${base}/v1/chat/completions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
  body: JSON.stringify({ model, messages: [{ role: 'user', content: PROMPT }] })
})
const t = await r.text()
console.log('HTTP', r.status)
if (!r.ok) { console.log(t.slice(0, 400)); process.exit(1) }
const content = JSON.parse(t).choices?.[0]?.message?.content || ''
console.log('原始返回前 120 字:', content.slice(0, 120).replace(/\n/g, ' '))

let s = content.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
const m = s.match(/\[[\s\S]*\]/)
if (m) s = m[0]
try {
  const arr = JSON.parse(s)
  console.log(`\n✅ 解析出 ${arr.length} 个元素：`)
  for (const c of arr) console.log(`  [${c.type}] ${c.name}: ${String(c.prompt).slice(0, 56)}…`)
} catch (e) {
  console.log('❌ 解析失败:', e.message)
}
