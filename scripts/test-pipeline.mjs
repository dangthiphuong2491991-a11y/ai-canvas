// 测试「智能管线」：依次跑 角色/场景/物品提取(JSON) → 合并 → 按四类排序
const apiKey = process.argv[2]
const model = process.argv[3] || 'gemini-2.5-flash'
const base = (process.env.BASE_URL || 'https://www.geeknow.top').trim().replace(/\/+$/, '').replace(/\/v1$/i, '')

const SCRIPT = `夜晚的赛博朋克都市，酸雨。
林夏，22岁女黑客，蓝色短发，破洞机能外套，手腕发光义体。
老陈，50岁前警探，络腮胡，灰色风衣，叼电子烟。
关键道具：一块刻着旧公司logo的黑色数据芯片；老陈的左轮手枪。
场景：地下黑市酒吧；雨夜天台。`

const CATS = ['场景', '人物', '物品', '分镜']

function tpl(what, fields, fixedType) {
  return {
    fixedType,
    content: [
      `根据提供的剧本，推导出文中出现过的所有${what}。`,
      `输出 JSON 数组，每项含 ${fields}。description 是高质量文生图提示词，尽量区分、避免雷同。`,
      '只返回 JSON 数组本身，不要解释或多余文字。',
      '## 输入',
      SCRIPT
    ].join('\n')
  }
}

const STAGES = [
  { label: '角色', t: tpl('人物', 'name(名字)、aliases(代称)、description(含年龄/性别/发色/发型/服饰)', '人物') },
  { label: '场景', t: tpl('重要场景/地点', 'name(场景名)、description(环境/光影/天气/氛围/镜头)', '场景') },
  { label: '物品', t: tpl('关键道具/装备', 'name(物品名)、description(材质/造型/细节/质感，干净背景)', '物品') }
]

function parse(text, fixedType) {
  let body = (text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const m = body.match(/\[[\s\S]*\]/)
  if (!m) return []
  let arr
  try { arr = JSON.parse(m[0]) } catch { return [] }
  if (!Array.isArray(arr)) return []
  return arr.filter((x) => x && (x.description || x.name)).map((x) => ({ type: fixedType, name: String(x.name || '未命名'), prompt: String(x.description || x.prompt || '') }))
}

async function f(url, o, n = 3) {
  for (let i = 0; i < n; i++) {
    try { return await fetch(url, o) } catch (e) { if (i === n - 1) throw e; await new Promise((r) => setTimeout(r, 700 * (i + 1))) }
  }
}

async function run(content, model) {
  const r = await f(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages: [{ role: 'user', content }] })
  })
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + (await r.text()).slice(0, 200))
  return JSON.parse(await r.text()).choices?.[0]?.message?.content || ''
}

const all = []
for (const st of STAGES) {
  process.stdout.write(`提取${st.label}…`)
  try {
    const out = await run(st.t.content, model)
    const items = parse(out, st.t.fixedType)
    all.push(...items)
    console.log(` ${items.length} 条`)
  } catch (e) {
    console.log(' 失败:', e.message)
  }
}
const merged = all.sort((a, b) => CATS.indexOf(a.type) - CATS.indexOf(b.type))
const dist = {}
for (const it of merged) dist[it.type] = (dist[it.type] || 0) + 1
console.log('\n=== 合并结果 ===')
console.log('总计', merged.length, '条，分布', JSON.stringify(dist))
merged.forEach((it, i) => console.log(`${i + 1}. [${it.type}] ${it.name} :: ${it.prompt.slice(0, 45)}…`))
