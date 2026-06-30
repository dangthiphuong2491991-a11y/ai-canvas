// 用用户的真实剧本(fixture-furforce.txt)实测：角色/场景/物品 JSON 提取 + 综合分隔符提取 能否解析
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const apiKey = process.argv[2]
const model = process.argv[3] || 'gemini-2.5-flash'
const base = (process.env.BASE_URL || 'https://www.geeknow.top').trim().replace(/\/+$/, '').replace(/\/v1$/i, '')
const __dirname = dirname(fileURLToPath(import.meta.url))
const SCRIPT = readFileSync(join(__dirname, 'fixture-furforce.txt'), 'utf8')

const SEP = '==='
const REC = '+++'
const OS = '_::~OUTPUT_START::~_'
const OE = '_::~OUTPUT_END::~_'

const jsonTpl = (what, fields, descReq) =>
  [
    `根据提供的小说原文 / 剧本，推导出文中出现过的所有${what}（尽量囊括全部）。`,
    `输出格式为 JSON 数组，每一项包含 ${fields} 字段。`,
    `其中 description 是一段高质量的「文生图」提示词，${descReq}`,
    '只返回 JSON 数组本身，不要任何解释、标题或多余文字。',
    '## 输入',
    SCRIPT
  ].join('\n')

const combined = [
  '## 核心任务',
  '你是专业的影视 / 游戏概念设计助手。阅读下面提供的剧本 / 故事，提取需要绘制概念图的元素，分四类：场景、人物、物品、分镜。',
  '为每个元素写一段高质量的「文生图」提示词。',
  '## 输入信息',
  '**故事情节：**',
  SCRIPT,
  '## 输出格式（务必严格遵守）',
  `1. 把全部结果用 ${OS} 和 ${OE} 包裹起来。`,
  `2. 记录与记录之间用「${REC}」分隔。`,
  `3. 每条记录内用「${SEP}」分隔三个字段：类型${SEP}名称${SEP}提示词。`,
  '4. 类型只能是 场景 / 人物 / 物品 / 分镜 之一。不要输出多余说明或代码块。'
].join('\n')

function parseJson(text, fixedType) {
  let body = (text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const m = body.match(/\[[\s\S]*\]/)
  if (!m) return { items: [], reason: '没找到 JSON 数组' }
  let arr
  try { arr = JSON.parse(m[0]) } catch (e) { return { items: [], reason: 'JSON.parse 失败: ' + e.message } }
  if (!Array.isArray(arr)) return { items: [], reason: '不是数组' }
  return { items: arr.filter((x) => x && (x.description || x.name)).map((x) => ({ type: fixedType, name: String(x.name || '?'), prompt: String(x.description || x.prompt || '') })), reason: 'ok' }
}

function parseDelim(text) {
  let body = text || ''
  if (body.includes(OS)) { const s = body.indexOf(OS) + OS.length; const e = body.indexOf(OE, s) >= 0 ? body.indexOf(OE, s) : body.length; body = body.slice(s, e) }
  body = body.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const out = []
  for (const r of body.split(REC).map((x) => x.trim()).filter(Boolean)) {
    const f = r.split(SEP).map((x) => x.trim())
    if (f.length >= 3) out.push({ type: f[0], name: f[1], prompt: f.slice(2).join(' ') })
  }
  return out
}

async function f(url, o, n = 3) {
  for (let i = 0; i < n; i++) { try { return await fetch(url, o) } catch (e) { if (i === n - 1) throw e; await new Promise((r) => setTimeout(r, 800 * (i + 1))) } }
}
async function run(content) {
  const r = await f(`${base}/v1/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model, messages: [{ role: 'user', content }] }) })
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + (await r.text()).slice(0, 200))
  return JSON.parse(await r.text()).choices?.[0]?.message?.content || ''
}

console.log('剧本长度', SCRIPT.length, '字 | 模型', model, '\n')

const tests = [
  { label: '角色提取(JSON)', content: jsonTpl('人物', 'name(名字)、aliases(代称)、description(形象描述)三个', '含年龄/性别/发色/发型/服饰。'), parse: (t) => parseJson(t, '人物') },
  { label: '场景提取(JSON)', content: jsonTpl('重要场景/地点', 'name(场景名)、description(画面描述)两个', '含环境/光影/天气/氛围/镜头视角。'), parse: (t) => parseJson(t, '场景') },
  { label: '物品提取(JSON)', content: jsonTpl('关键物品/道具', 'name(物品名)、description(画面描述)两个', '含材质/造型/细节/质感，干净背景。'), parse: (t) => parseJson(t, '物品') }
]

for (const t of tests) {
  try {
    const out = await run(t.content)
    const res = t.parse(out)
    console.log(`【${t.label}】返回 ${out.length} 字 → 解析 ${res.items.length} 条 (${res.reason || 'ok'})`)
    res.items.slice(0, 8).forEach((it) => console.log(`   - ${it.name} :: ${it.prompt.slice(0, 40)}…`))
    if (!res.items.length) console.log('   原始返回尾部:', out.slice(-160).replace(/\n/g, ' '))
  } catch (e) { console.log(`【${t.label}】请求失败:`, e.message) }
}

try {
  const out = await run(combined)
  const items = parseDelim(out)
  const dist = {}; for (const it of items) dist[it.type] = (dist[it.type] || 0) + 1
  console.log(`\n【综合提取(分隔符)】返回 ${out.length} 字 → 解析 ${items.length} 条`, JSON.stringify(dist))
  if (!items.length) console.log('   原始返回前 200:', out.slice(0, 200).replace(/\n/g, ' '))
} catch (e) { console.log('【综合提取】请求失败:', e.message) }
