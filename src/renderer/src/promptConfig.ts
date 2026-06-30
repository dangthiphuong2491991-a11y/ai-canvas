// 提示词模板（对标「字字动画」提示词模板）：分类 + 每个模板是一整段带 {{变量}} 的完整提示词正文。
// 角色/场景/物品提取用 JSON 格式（[{name, aliases?, description}]，description 即出图提示词）；
// 综合提取/分镜推理可用「输出标记 + 记录/内容分隔符」格式。解析按模板分类感知。
// 角色/场景/物品三套官方模板正文存在 templates/*.txt（含 ```json 代码块，用 ?raw 原样导入避免反引号转义）
import charTemplate from './templates/char.txt?raw'
import sceneTemplate from './templates/scene.txt?raw'
import itemTemplate from './templates/item.txt?raw'
import storyboardTemplate from './templates/storyboard.txt?raw'

export type TemplateSource = 'official' | 'user'

// 模板分类（对标字字动画的分类 Tab）
export const TEMPLATE_CATEGORIES = ['综合提取', '角色提取', '场景提取', '物品提取', '分镜推理', '自定义'] as const
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number]

export interface PromptTemplate {
  id: string
  name: string
  source: TemplateSource
  category: TemplateCategory
  modelPlatform: string // 模型平台（本应用只有一个中转站，默认 '默认'）
  model: string // 模型选择（'默认' = 用节点上选的对话模型）
  contentSep: string // 内容分隔符（字段之间）
  recordSep: string // 记录分隔符（元素之间）
  outputStart: string // 输出开始符
  outputEnd: string // 输出结束符
  content: string // 提示词正文，含 {{变量}}
}

// 出图元素四类（用于彩色徽标 / 排序）
export const CATS = ['场景', '人物', '物品', '分镜'] as const
export type Cat = (typeof CATS)[number]

// 可点击插入的变量。本应用主要用「故事情节 / 输入文案 / 小说原文」= 粘贴的剧本
export const TEMPLATE_VARS = [
  '故事情节',
  '推文文案',
  '小说原文',
  '输入文案',
  '角色信息',
  '场景信息',
  '物品信息',
  '章节情节',
  '匹配角色',
  '反推结果',
  '前面文案',
  '后面文案',
  '当前提示词'
] as const

export const DEFAULT_MARKERS = {
  contentSep: '===',
  recordSep: '+++',
  outputStart: '_::~OUTPUT_START::~_',
  outputEnd: '_::~OUTPUT_END::~_'
}

const { contentSep: SEP, recordSep: REC, outputStart: OS, outputEnd: OE } = DEFAULT_MARKERS

// 分类 → 该分类元素固定类型（角色/场景/物品/分镜提取时类型已知；综合/自定义为空=按输出里的 type 判断）
export function fixedTypeFor(cat: TemplateCategory): Cat | '' {
  return cat === '角色提取' ? '人物' : cat === '场景提取' ? '场景' : cat === '物品提取' ? '物品' : cat === '分镜推理' ? '分镜' : ''
}

// ---- 综合提取（分隔符格式，一次出全部四类）----
function combinedContent(styleLine: string): string {
  return [
    '## 核心任务',
    '你是专业的影视 / 游戏概念设计助手。阅读下面提供的剧本 / 故事，提取需要绘制概念图的元素，分四类：场景、人物、物品、分镜。',
    '- 场景：突出环境地点、光影、天气、氛围与镜头视角',
    '- 人物：突出外貌、年龄、发型、服饰、表情与全身姿态',
    '- 物品：突出材质、造型、细节与质感，干净背景',
    '- 分镜：描述一个关键镜头：画面构图、人物动作、机位与景别、情绪',
    styleLine,
    '',
    '## 输入信息',
    '**故事情节：**',
    '{{故事情节}}',
    '',
    '## 输出格式（务必严格遵守）',
    `1. 把全部结果用 ${OS} 和 ${OE} 包裹起来。`,
    `2. 每个元素是一条记录，记录与记录之间用「${REC}」分隔。`,
    `3. 每条记录内用「${SEP}」分隔三个字段，顺序固定为：类型${SEP}名称${SEP}提示词。`,
    '4. 类型只能是 场景 / 人物 / 物品 / 分镜 之一。',
    '5. 除被包裹的内容外，不要输出任何解释、标题或 markdown 代码块。'
  ].join('\n')
}

export const DEFAULT_TEMPLATES: PromptTemplate[] = [
  {
    id: 'default',
    name: '默认 - 综合概念图',
    source: 'official',
    category: '综合提取',
    modelPlatform: '默认',
    model: '默认',
    contentSep: SEP,
    recordSep: REC,
    outputStart: OS,
    outputEnd: OE,
    content: combinedContent('为每个元素写一段高质量的「文生图」提示词，覆盖以上要点。')
  },
  {
    id: 'char',
    name: '通用角色（疯狂动物城拟人）',
    source: 'official',
    category: '角色提取',
    modelPlatform: '默认',
    model: '默认',
    contentSep: SEP,
    recordSep: REC,
    outputStart: '',
    outputEnd: '',
    content: charTemplate
  },
  {
    id: 'scene',
    name: '通用场景（无人空镜）',
    source: 'official',
    category: '场景提取',
    modelPlatform: '默认',
    model: '默认',
    contentSep: SEP,
    recordSep: REC,
    outputStart: '',
    outputEnd: '',
    content: sceneTemplate
  },
  {
    id: 'item',
    name: '通用物品（三视图）',
    source: 'official',
    category: '物品提取',
    modelPlatform: '默认',
    model: '默认',
    contentSep: SEP,
    recordSep: REC,
    outputStart: '',
    outputEnd: '',
    content: itemTemplate
  },
  {
    id: 'storyboard',
    name: '15秒分镜组（短剧分镜）',
    source: 'official',
    category: '分镜推理',
    modelPlatform: '默认',
    model: '默认',
    contentSep: SEP,
    recordSep: REC,
    outputStart: OS,
    outputEnd: OE,
    content: storyboardTemplate
  }
]

// 官方模板始终以代码里的为准（这样更新内置提示词能推到老画布），用户自建模板保留。
// 官方在前、用户在后。
export function withOfficialTemplates(saved: PromptTemplate[]): PromptTemplate[] {
  const officialIds = new Set(DEFAULT_TEMPLATES.map((d) => d.id))
  const users = saved.filter((t) => !officialIds.has(t.id))
  return [...DEFAULT_TEMPLATES.map((d) => ({ ...d })), ...users]
}

let _seq = 0
export function newTemplateId(): string {
  // Date.now/Math.random 的禁用只针对 Workflow 脚本，应用代码可用
  _seq += 1
  return 'tpl_' + Math.random().toString(36).slice(2, 8) + _seq
}

// 把 {{变量}} 替换为实际值；未知变量替换成空串
export function renderTemplate(content: string, vars: Record<string, string>): string {
  return content.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, key) => {
    const k = String(key).trim()
    return k in vars ? vars[k] : ''
  })
}

export interface RawItem {
  type: string
  name: string
  aliases: string
  prompt: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tryJsonArray(body: string): any[] | null {
  const m = body.match(/\[[\s\S]*\]/)
  if (!m) return null
  try {
    const a = JSON.parse(m[0])
    return Array.isArray(a) ? a : null
  } catch {
    return null
  }
}

// 兜底：JSON 数组被截断（输出超长）时，逐个抢救出完整的 {...} 对象
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function salvageObjects(body: string): any[] {
  if (!body.includes('{') || !/"(name|description|prompt|type)"/.test(body)) return []
  const out: unknown[] = []
  // 平铺对象（无嵌套大括号），非贪婪匹配到第一个 } ；末尾被截断的不完整对象会自然丢弃
  const re = /\{[^{}]*\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(body))) {
    try {
      out.push(JSON.parse(m[0]))
    } catch {
      /* 跳过坏对象 */
    }
  }
  return out
}

// 分镜脚本解析：取 _::~FIELD::~_ 之后的镜头列表，按「镜头N：」切成条目，描述即出图/分镜词
function parseStoryboard(body: string): RawItem[] {
  const fieldIdx = body.indexOf('_::~FIELD::~_')
  const shots = fieldIdx >= 0 ? body.slice(fieldIdx + '_::~FIELD::~_'.length) : body
  const out: RawItem[] = []
  const re = /镜头\s*(\d+)\s*[：:]\s*([\s\S]*?)(?=镜头\s*\d+\s*[：:]|（\s*no\s*srt|$)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(shots))) {
    const txt = m[2].trim()
    if (txt) out.push({ type: '分镜', name: '镜头' + m[1], aliases: '', prompt: txt })
  }
  return out
}

// 解析模型输出。按模板分类：角色/场景/物品 → 固定类型 + JSON 取 description 当出图词；
// 分镜推理 → 按「镜头N：」切；综合/自定义 → 输出里自带 type（JSON 或 分隔符格式）。
export function parseExtraction(text: string, tpl: PromptTemplate): RawItem[] {
  let body = text || ''
  if (tpl.outputStart && body.includes(tpl.outputStart)) {
    const s = body.indexOf(tpl.outputStart) + tpl.outputStart.length
    const e = tpl.outputEnd && body.indexOf(tpl.outputEnd, s) >= 0 ? body.indexOf(tpl.outputEnd, s) : body.length
    body = body.slice(s, e)
  }
  body = body
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim()

  const fixed = fixedTypeFor(tpl.category)

  // 分镜推理：先按镜头切；切到了就用，没切到再走通用逻辑兜底
  if (tpl.category === '分镜推理') {
    const shots = parseStoryboard(body)
    if (shots.length) return shots
  }

  // 先试完整 JSON 数组；失败再抢救被截断的对象
  const arr = tryJsonArray(body) || salvageObjects(body)
  if (arr && arr.length) {
    return arr
      .filter((x) => x && (x.description || x.prompt || x.name))
      .map((x) => ({
        type: fixed || String(x.type || '人物'),
        name: String(x.name || x.title || '未命名'),
        aliases: String(x.aliases || x.alias || ''),
        prompt: String(x.description || x.prompt || x.desc || x.name || '')
      }))
  }

  // 分隔符格式兜底
  const sep = tpl.contentSep || SEP
  const rec = tpl.recordSep || REC
  const records = body
    .split(rec)
    .map((r) => r.trim())
    .filter(Boolean)
  const out: RawItem[] = []
  for (const r of records) {
    const f = r.split(sep).map((s) => s.trim())
    if (fixed) {
      // 固定类型：name===描述 或 仅描述
      if (f.length >= 2) out.push({ type: fixed, name: f[0], aliases: '', prompt: f.slice(1).join(' ') })
      else if (f[0]) out.push({ type: fixed, name: '未命名', aliases: '', prompt: f[0] })
    } else {
      if (f.length >= 3) out.push({ type: f[0], name: f[1], aliases: '', prompt: f.slice(2).join(' ') })
      else if (f.length === 2) out.push({ type: '人物', name: f[0], aliases: '', prompt: f[1] })
      else if (f[0]) out.push({ type: '人物', name: '未命名', aliases: '', prompt: f[0] })
    }
  }
  return out
}

// 旧数据迁移：把老的「四类 cats + 前后缀」配置转成一条综合提取 content 模板
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function templateFromLegacy(legacy: any): PromptTemplate {
  const cats = legacy?.cats || {}
  const styleParts: string[] = ['为每个元素写一段高质量的「文生图」提示词。']
  if (legacy?.prefix) styleParts.push('每条提示词开头统一加上：' + legacy.prefix + '。')
  if (legacy?.suffix) styleParts.push('每条提示词结尾统一加上：' + legacy.suffix + '。')
  const content = [
    '## 核心任务',
    '你是专业的影视 / 游戏概念设计助手。阅读下面提供的剧本 / 故事，提取需要绘制概念图的元素，分四类：',
    '- 场景：' + (cats.场景 || '突出环境地点、光影、天气、氛围与镜头视角'),
    '- 人物：' + (cats.人物 || '突出外貌、年龄、发型、服饰、表情与全身姿态'),
    '- 物品：' + (cats.物品 || '突出材质、造型、细节与质感，干净背景'),
    '- 分镜：' + (cats.分镜 || '描述一个关键镜头：画面构图、人物动作、机位与景别、情绪'),
    styleParts.join(''),
    '',
    '## 输入信息',
    '**故事情节：**',
    '{{故事情节}}',
    '',
    '## 输出格式（务必严格遵守）',
    `把全部结果用 ${OS} 和 ${OE} 包裹。每条记录用「${REC}」分隔；每条记录内用「${SEP}」分隔：类型${SEP}名称${SEP}提示词。类型只能是 场景 / 人物 / 物品 / 分镜。不要输出多余说明。`
  ].join('\n')
  return {
    id: legacy?.id || newTemplateId(),
    name: legacy?.name || '默认模板',
    source: legacy?.source === 'official' ? 'official' : 'user',
    category: '综合提取',
    modelPlatform: '默认',
    model: '默认',
    contentSep: SEP,
    recordSep: REC,
    outputStart: OS,
    outputEnd: OE,
    content
  }
}

const CAT_SET = new Set<string>(TEMPLATE_CATEGORIES as readonly string[])

// 把任意保存的模板对象规范化成最新结构
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeTemplate(t: any): PromptTemplate {
  if (t && typeof t.content === 'string' && t.content.trim()) {
    return {
      id: t.id || newTemplateId(),
      name: t.name || '未命名模板',
      source: t.source === 'official' ? 'official' : 'user',
      category: CAT_SET.has(t.category) ? t.category : '综合提取',
      modelPlatform: t.modelPlatform || '默认',
      model: t.model || '默认',
      contentSep: t.contentSep || SEP,
      recordSep: t.recordSep || REC,
      outputStart: t.outputStart ?? OS,
      outputEnd: t.outputEnd ?? OE,
      content: t.content
    }
  }
  return templateFromLegacy(t)
}
