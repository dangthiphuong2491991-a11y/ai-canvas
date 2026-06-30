// 测试新版「内容模板 + 分隔符输出」的提取链路：渲染模板 → chat → parseExtraction（分隔符 + JSON 兜底）
const apiKey = process.argv[2]
const model = process.argv[3] || 'gemini-2.5-flash'
const base = (process.env.BASE_URL || 'https://www.geeknow.top').trim().replace(/\/+$/, '').replace(/\/v1$/i, '')

const SEP = '==='
const REC = '+++'
const OS = '_::~OUTPUT_START::~_'
const OE = '_::~OUTPUT_END::~_'

const SCRIPT = `夜晚的赛博朋克都市，霓虹与酸雨。
林夏，22岁女黑客，蓝色短发，破洞机能外套，手腕发光义体。
老陈，50岁前警探，络腮胡，灰色风衣，叼电子烟。
机器人 K-9，银白流线机身，单眼红色光学传感器。
高潮镜头：林夏在天台edge俯瞰city，回头特写。`

// 默认模板正文（与 promptConfig.ts buildContent 一致），{{故事情节}} 已替换
const content = [
  '## 核心任务',
  '你是专业的影视 / 游戏概念设计助手。阅读下面提供的剧本 / 故事，提取需要绘制概念图的元素，分四类：场景、人物、物品、分镜。',
  '- 场景：突出环境地点、光影、天气、氛围与镜头视角',
  '- 人物：突出外貌、年龄、发型、服饰、表情与全身姿态',
  '- 物品：突出材质、造型、细节与质感，干净背景',
  '- 分镜：描述一个关键镜头：画面构图、人物动作、机位与景别、情绪',
  '为每个元素写一段高质量的「文生图」提示词，覆盖以上要点。',
  '',
  '## 输入信息',
  '**故事情节：**',
  SCRIPT,
  '',
  '## 输出格式（务必严格遵守）',
  `1. 把全部结果用 ${OS} 和 ${OE} 包裹起来。`,
  `2. 每个元素是一条记录，记录与记录之间用「${REC}」分隔。`,
  `3. 每条记录内用「${SEP}」分隔三个字段，顺序固定为：类型${SEP}名称${SEP}提示词。`,
  '4. 类型只能是 场景 / 人物 / 物品 / 分镜 之一。',
  '5. 除被包裹的内容外，不要输出任何解释、标题或 markdown 代码块。'
].join('\n')

function parseExtraction(text) {
  let body = text || ''
  if (body.includes(OS)) {
    const s = body.indexOf(OS) + OS.length
    const e = body.indexOf(OE, s) >= 0 ? body.indexOf(OE, s) : body.length
    body = body.slice(s, e)
  }
  body = body.trim()
  const jm = body.match(/\[[\s\S]*\]/)
  if (jm) {
    try {
      const arr = JSON.parse(jm[0])
      if (Array.isArray(arr) && arr.some((x) => x && (x.prompt || x.name)))
        return arr.filter((x) => x && (x.prompt || x.name)).map((x) => ({ type: String(x.type || '人物'), name: String(x.name || '未命名'), prompt: String(x.prompt || '') }))
    } catch {}
  }
  const out = []
  for (const r of body.split(REC).map((x) => x.trim()).filter(Boolean)) {
    const f = r.split(SEP).map((x) => x.trim())
    if (f.length >= 3) out.push({ type: f[0], name: f[1], prompt: f.slice(2).join(' ') })
    else if (f.length === 2) out.push({ type: '人物', name: f[0], prompt: f[1] })
    else if (f.length === 1 && f[0]) out.push({ type: '人物', name: '未命名', prompt: f[0] })
  }
  return out
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
console.log('--- 原始返回（前 300 字）---')
console.log(out.slice(0, 300))
console.log('--- 解析结果 ---')
const items = parseExtraction(out)
console.log('共解析出', items.length, '条')
const byType = {}
for (const it of items) byType[it.type] = (byType[it.type] || 0) + 1
console.log('类型分布:', JSON.stringify(byType))
items.slice(0, 6).forEach((it, i) => console.log(`${i + 1}. [${it.type}] ${it.name} :: ${it.prompt.slice(0, 60)}…`))
