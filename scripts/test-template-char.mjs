// 测试「角色提取」JSON 模板 + 分类感知解析（固定类型=人物，description=出图词）
const apiKey = process.argv[2]
const model = process.argv[3] || 'gemini-2.5-flash'
const base = (process.env.BASE_URL || 'https://www.geeknow.top').trim().replace(/\/+$/, '').replace(/\/v1$/i, '')

const SCRIPT = `夜晚的赛博朋克都市。
林夏，22岁女黑客（人称阿霜、银发），蓝色短发，破洞机能外套，手腕发光义体。
老陈，50岁前警探，络腮胡，灰色风衣，叼电子烟。
机器人 K-9，银白流线机身，单眼红色光学传感器。`

const content = [
  '根据提供的小说原文 / 剧本，推导出文中出现过的所有人物（包括"我"在内，尽量囊括全部）。',
  '输出格式为 JSON 数组，每一项包含 name（名字）、aliases（代称，多个用逗号分割）、description（形象描述）三个 字段。',
  '其中 description 是一段高质量的「文生图」提示词，必须包含：年龄、性别、发色、发型、眼睛颜色、上身服装、下身服装，并适当补充画质词。',
  '每一项的形象/画面要尽量区分，避免雷同。',
  '只返回 JSON 数组本身，不要任何解释、标题或多余文字。',
  '',
  '## 输入',
  SCRIPT
].join('\n')

// 分类感知解析（固定类型 = 人物）
function parseChar(text) {
  let body = (text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const m = body.match(/\[[\s\S]*\]/)
  if (!m) return []
  let arr
  try { arr = JSON.parse(m[0]) } catch { return [] }
  if (!Array.isArray(arr)) return []
  return arr
    .filter((x) => x && (x.description || x.prompt || x.name))
    .map((x) => ({ type: '人物', name: String(x.name || '未命名'), aliases: x.aliases || '', prompt: String(x.description || x.prompt || '') }))
}

async function f(url, o, n = 3) {
  for (let i = 0; i < n; i++) {
    try { return await fetch(url, o) } catch (e) { if (i === n - 1) throw e; await new Promise((r) => setTimeout(r, 700 * (i + 1))) }
  }
}

console.log('提取模型:', model)
const r = await f(`${base}/v1/chat/completions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
  body: JSON.stringify({ model, messages: [{ role: 'user', content }] })
})
const t = await r.text()
console.log('HTTP', r.status)
if (!r.ok) { console.log(t.slice(0, 500)); process.exit(1) }
const out = JSON.parse(t).choices?.[0]?.message?.content || ''
console.log('--- 原始返回（前 200 字）---')
console.log(out.slice(0, 200))
console.log('--- 解析结果 ---')
const items = parseChar(out)
console.log('共解析出', items.length, '个人物')
items.forEach((it, i) => console.log(`${i + 1}. ${it.name}（${it.aliases}） :: ${it.prompt.slice(0, 55)}…`))
