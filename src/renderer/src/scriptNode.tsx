import { useState, useContext } from 'react'
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  useEditor,
  track,
  stopEventPropagation,
  createShapeId,
  createBindingId,
  T,
  type TLBaseShape,
  type RecordProps
} from 'tldraw'
// v5.1.1 的迁移辅助函数没从 tldraw 主包导出，从 tlschema 取（tldraw 内部用的同一份）
import { createShapePropsMigrationIds, createShapePropsMigrationSequence } from '@tldraw/tlschema'
import { GenContext, prettifyModel } from './genNode'
import { renderTemplate, parseExtraction, CATS, type PromptTemplate } from './promptConfig'

export type ScriptNodeShape = TLBaseShape<
  'scriptNode',
  { w: number; h: number; script: string; items: string; templateId: string; tplSel: string }
>

const SW = 460

// 节点里按类单独选模板/单独推理的四类（type=元素类型，cls=徽标配色）
const PIPE_CATS: Array<{ cat: string; label: string; type: string; cls: string }> = [
  { cat: '角色提取', label: '角色', type: '人物', cls: 'char' },
  { cat: '场景提取', label: '场景', type: '场景', cls: 'scene' },
  { cat: '物品提取', label: '物品', type: '物品', cls: 'prop' },
  { cat: '分镜推理', label: '分镜', type: '分镜', cls: 'shot' }
]

interface Item {
  type: string
  name: string
  aliases: string
  prompt: string
  status: 'idle' | 'loading' | 'done' | 'error'
}

function typeCls(t: string): string {
  return t === '场景' ? 'scene' : t === '物品' ? 'prop' : t === '分镜' ? 'shot' : 'char'
}

// 选一个适合做「剧本提取」的对话模型：优先 gemini flash / deepseek / gpt-4o-mini 等稳的，
// 避开 realtime / audio / 纯视觉等不适合长文本 JSON 的型号
function pickDefaultChatModel(models: string[]): string {
  const bad = /realtime|audio|tts|whisper|vision|embed|image|search|o1-mini|moderation/i
  const good = models.filter((m) => !bad.test(m))
  const prefs = [
    /gemini-2\.5-flash$/i,
    /gemini.*flash/i,
    /deepseek-chat|deepseek-v3/i,
    /gpt-4o-mini/i,
    /gpt-4o/i,
    /claude.*(haiku|sonnet)/i,
    /glm-4/i,
    /qwen/i
  ]
  for (const re of prefs) {
    const hit = good.find((m) => re.test(m))
    if (hit) return hit
  }
  return good[0] || models[0] || ''
}

function parseItems(text: string, tpl: PromptTemplate): Item[] {
  const order = CATS as readonly string[]
  return parseExtraction(text, tpl)
    .filter((x) => x.prompt || x.name)
    .map((x) => ({
      type: order.includes(x.type) ? x.type : '人物',
      name: x.name || '未命名',
      aliases: x.aliases || '',
      prompt: x.prompt || x.name,
      status: 'idle' as const
    }))
    .sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type))
}

function loadDim(src: string): Promise<{ w: number; h: number }> {
  return new Promise((res) => {
    const i = new Image()
    i.onload = () => res({ w: i.naturalWidth || 1024, h: i.naturalHeight || 1024 })
    i.onerror = () => res({ w: 1024, h: 1024 })
    i.src = src
  })
}

const ScriptBody = track(function ScriptBody({ shape }: { shape: ScriptNodeShape }) {
  const editor = useEditor()
  const ctx = useContext(GenContext)
  const p = shape.props
  const [script, setScript] = useState(p.script)
  const [imgModel, setImgModel] = useState(ctx.defaultModel)
  const [chatModel, setChatModel] = useState(() => pickDefaultChatModel(ctx.textModels))
  const [items, setItems] = useState<Item[]>(() => {
    try {
      return JSON.parse(p.items || '[]')
    } catch {
      return []
    }
  })
  const [extracting, setExtracting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [genAt, setGenAt] = useState(0)
  const [err, setErr] = useState('')
  const [runningCat, setRunningCat] = useState('') // 正在推理的分类（'' = 无）

  // 每类（角色/场景/物品/分镜）各自单独选模板；空 = 跳过该类
  const firstIdOf = (cat: string): string => ctx.templates.find((t) => t.category === cat)?.id || ''
  const [selMap, setSelMap] = useState<Record<string, string>>(() => {
    let saved: Record<string, string> = {}
    try {
      saved = JSON.parse(p.tplSel || '{}')
    } catch {
      /* ignore */
    }
    const init: Record<string, string> = {}
    for (const { cat } of PIPE_CATS) {
      // 默认选该类第一套模板（四类都有官方默认）
      init[cat] = cat in saved ? saved[cat] : firstIdOf(cat)
    }
    return init
  })

  const save = (s: string, its: Item[]): void =>
    editor.updateShape({
      id: shape.id,
      type: 'scriptNode',
      props: { script: s, items: JSON.stringify(its), tplSel: JSON.stringify(selMap) }
    })
  const pickCat = (cat: string, id: string): void => {
    const next = { ...selMap, [cat]: id }
    setSelMap(next)
    editor.updateShape({ id: shape.id, type: 'scriptNode', props: { tplSel: JSON.stringify(next) } })
  }
  const setItem = (i: number, patch: Partial<Item>): void =>
    setItems((xs) => xs.map((c, idx) => (idx === i ? { ...c, ...patch } : c)))

  // 跑一套模板：渲染 {{变量}} → 对话模型 → 分类感知解析成元素
  async function runTemplate(t: PromptTemplate, extraVars: Record<string, string>): Promise<Item[]> {
    const prompt = renderTemplate(t.content, {
      故事情节: script,
      输入文案: script,
      小说原文: script,
      推文文案: script,
      当前提示词: script,
      ...extraVars
    })
    const useModel = t.model && t.model !== '默认' ? t.model : chatModel
    const text = await window.api.textGenerate({
      baseURL: ctx.baseURL,
      apiKey: ctx.apiKey,
      model: useModel,
      prompt
    })
    return parseItems(text, t)
  }

  function preflight(): boolean {
    if (!ctx.apiKey) {
      setErr('请先在设置里填入 API 令牌')
      ctx.openSettings('image')
      return false
    }
    if (!script.trim()) {
      setErr('请先粘贴剧本')
      return false
    }
    return true
  }

  const selTpl = (cat: string): PromptTemplate | undefined => {
    const id = selMap[cat]
    return id ? ctx.templates.find((t) => t.id === id && t.category === cat) : undefined
  }

  // 单独推理某一类（角色/场景/物品/分镜各自一个按钮）：只刷新这一类的元素
  async function runCategory(entry: { cat: string; label: string; type: string }): Promise<void> {
    if (!preflight()) return
    const t = selTpl(entry.cat)
    if (!t) {
      setErr(`「${entry.label}」还没选模板——在上面选一套，或点「⚙ 模板」新建`)
      return
    }
    setRunningCat(entry.cat)
    setErr('')
    try {
      // 分镜推理用已提取的角色/场景/物品当上下文
      let extra: Record<string, string> = {}
      if (entry.cat === '分镜推理') {
        const lib = (type: string): string =>
          items
            .filter((i) => i.type === type)
            .map((i) => `${i.name}：${i.prompt}`)
            .join('\n')
        extra = { 角色信息: lib('人物'), 场景信息: lib('场景'), 物品信息: lib('物品') }
      }
      const got = await runTemplate(t, extra)
      if (!got.length)
        throw new Error(`${entry.label}没解析出元素（模型可能没按格式输出或被截断），换个对话模型再试`)
      const order = CATS as readonly string[]
      // 替换掉这一类的旧元素，保留其它类
      const kept = items.filter((i) => i.type !== entry.type)
      const merged = [...kept, ...got].sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type))
      setItems(merged)
      save(script, merged)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setRunningCat('')
    }
  }

  function connect(toId: string): void {
    try {
      const aId = createShapeId()
      editor.createShape({ id: aId, type: 'arrow', isLocked: true, props: { color: 'white' } })
      editor.createBindings([
        {
          id: createBindingId(),
          type: 'arrow',
          fromId: aId as never,
          toId: shape.id as never,
          props: { terminal: 'start', normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false }
        },
        {
          id: createBindingId(),
          type: 'arrow',
          fromId: aId as never,
          toId: toId as never,
          props: { terminal: 'end', normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false }
        }
      ])
    } catch {
      /* ignore */
    }
  }

  // 立即建一个图片节点（含 名称/别名/描述，占位 loading），并从剧本节点连线出去；返回节点 id
  function createResultNode(item: Item, index: number): string {
    const sb = editor.getShapePageBounds(shape.id)
    const size = 220
    const cols = 4
    const gx = (sb?.maxX ?? shape.x) + 150
    const gy = sb?.minY ?? shape.y
    const x = gx + (index % cols) * (size + 50)
    const y = gy + Math.floor(index / cols) * (size + 80)
    const id = createShapeId()
    editor.createShape({
      id,
      type: 'genNode',
      x,
      y,
      props: {
        w: size,
        h: size,
        src: '',
        title: item.name,
        aliases: item.aliases,
        prompt: item.prompt,
        model: ctx.defaultModel,
        size: ctx.defaultSize,
        status: 'loading',
        error: ''
      }
    })
    connect(id as string)
    return id as string
  }

  // 生成单条（每条元素自己的生成按钮）：先把提示词分发成节点，再填图
  async function generateItem(i: number): Promise<boolean> {
    const it = items[i]
    if (!it) return false
    if (!ctx.apiKey) {
      setErr('请先在设置里填入 API 令牌')
      ctx.openSettings('image')
      return false
    }
    setItem(i, { status: 'loading' })
    const nodeId = createResultNode(it, i) // 节点立即出现（含名称/别名/描述）
    try {
      let src = ''
      if (ctx.apiType === 'task521' || /521xxz\.com/i.test(ctx.baseURL)) {
        const r = await window.api.task521Image({
          baseURL: ctx.baseURL,
          apiKey: ctx.apiKey,
          model: imgModel,
          prompt: it.prompt,
          aspectRatio: '1:1'
        })
        src = r.url || ''
      } else if (/gemini|banana/i.test(imgModel)) {
        const r = await window.api.imageChat({
          baseURL: ctx.baseURL,
          apiKey: ctx.apiKey,
          model: imgModel,
          prompt: it.prompt,
          images: []
        })
        src = r.b64 ? `data:image/png;base64,${r.b64}` : r.url || ''
      } else {
        const res = await window.api.generateImage({
          baseURL: ctx.baseURL,
          apiKey: ctx.apiKey,
          model: imgModel,
          prompt: it.prompt,
          size: ctx.defaultSize,
          n: 1
        })
        src = res[0]?.b64 ? `data:image/png;base64,${res[0].b64}` : res[0]?.url || ''
      }
      if (!src) throw new Error('no image')
      const dim = await loadDim(src)
      editor.updateShape({
        id: nodeId as never,
        type: 'genNode',
        props: { src, status: 'idle', h: Math.round((220 * dim.h) / dim.w) }
      })
      setItem(i, { status: 'done' })
      return true
    } catch (e) {
      editor.updateShape({
        id: nodeId as never,
        type: 'genNode',
        props: { status: 'error', error: (e as Error).message }
      })
      setItem(i, { status: 'error' })
      return false
    }
  }

  async function generateAll(): Promise<void> {
    if (!items.length) return
    setBusy(true)
    setErr('')
    for (let i = 0; i < items.length; i++) {
      setGenAt(i)
      await generateItem(i)
    }
    setBusy(false)
  }

  const imgOptions = ctx.imageModels.includes(imgModel) ? ctx.imageModels : [imgModel, ...ctx.imageModels]
  const chatOptions = ctx.textModels.includes(chatModel)
    ? ctx.textModels
    : chatModel
      ? [chatModel, ...ctx.textModels]
      : ctx.textModels

  return (
    <div className="snode" style={{ width: p.w, height: p.h }}>
      <div className="snode-label">⚡ 剧本批量生成</div>
      <div className="snode-body" onPointerDown={stopEventPropagation} onWheel={(e) => e.stopPropagation()}>
        <textarea
          className="snode-script"
          placeholder="粘贴剧本 / 故事…我会按设置里的模板提取 场景/人物/物品/分镜"
          value={script}
          onChange={(e) => setScript(e.target.value)}
          onBlur={() => save(script, items)}
        />
        {/* 每类各自选模板 + 各自独立「推理」按钮（角色/场景/物品/分镜分开跑） */}
        <div className="snode-cats">
          {PIPE_CATS.map((entry) => {
            const opts = ctx.templates.filter((t) => t.category === entry.cat)
            const running = runningCat === entry.cat
            const cnt = items.filter((i) => i.type === entry.type).length
            return (
              <div className="snode-catrow" key={entry.cat}>
                <span className={'snode-dot t-' + entry.cls} />
                <span className="snode-catk">
                  {entry.label}
                  {cnt > 0 && <i className="snode-catn">{cnt}</i>}
                </span>
                <select
                  className="node-sel"
                  value={selMap[entry.cat] || ''}
                  onChange={(e) => pickCat(entry.cat, e.target.value)}
                  title={entry.label + '模板'}
                >
                  <option value="">跳过</option>
                  {opts.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <button
                  className="snode-run"
                  onClick={() => runCategory(entry)}
                  disabled={!!runningCat || busy || !selMap[entry.cat]}
                  title={'单独推理' + entry.label}
                >
                  {running ? '推理中…' : '推理'}
                </button>
              </div>
            )
          })}
          <button className="snode-tplmanage" onClick={ctx.openTemplates} title="新建 / 编辑提示词模板">
            ⚙ 管理模板
          </button>
        </div>
        <div className="snode-row">
          <select className="node-sel" value={chatModel} onChange={(e) => setChatModel(e.target.value)} title="提取模型">
            {chatOptions.length ? (
              chatOptions.map((m) => (
                <option key={m} value={m}>
                  {prettifyModel(m)}
                </option>
              ))
            ) : (
              <option value="">提取模型</option>
            )}
          </select>
          <select className="node-sel" value={imgModel} onChange={(e) => setImgModel(e.target.value)} title="出图模型">
            {imgOptions.map((m) => (
              <option key={m} value={m}>
                {prettifyModel(m)}
              </option>
            ))}
          </select>
        </div>

        {items.length > 0 && (
          <div className="snode-list">
            {items.map((c, i) => (
              <div className={'snode-item s-' + c.status} key={i}>
                <div className="snode-itemhd">
                  <span className={'batch-type t-' + typeCls(c.type)}>{c.type}</span>
                  <input
                    className="snode-name"
                    value={c.name}
                    onChange={(e) => setItem(i, { name: e.target.value })}
                    onBlur={() => save(script, items)}
                    placeholder="名称"
                  />
                  <button
                    className="snode-gen"
                    onClick={() => generateItem(i)}
                    disabled={busy || c.status === 'loading'}
                    title="生成这条的图片"
                  >
                    {c.status === 'loading' ? '⏳' : c.status === 'done' ? '✓ 重生' : '🎨 生成'}
                  </button>
                  <button
                    className="batch-del"
                    onClick={() => {
                      const next = items.filter((_, idx) => idx !== i)
                      setItems(next)
                      save(script, next)
                    }}
                    title="删除这条"
                  >
                    ×
                  </button>
                </div>
                {c.aliases && (
                  <input
                    className="snode-aliases"
                    value={c.aliases}
                    onChange={(e) => setItem(i, { aliases: e.target.value })}
                    onBlur={() => save(script, items)}
                    placeholder="别名"
                  />
                )}
                <textarea
                  className="snode-cp"
                  rows={2}
                  value={c.prompt}
                  onChange={(e) => setItem(i, { prompt: e.target.value })}
                  onBlur={() => save(script, items)}
                  placeholder="描述（出图提示词）"
                />
              </div>
            ))}
          </div>
        )}

        {items.length > 0 && (
          <button className="primary wide" onClick={generateAll} disabled={busy}>
            {busy ? `批量生成中… ${genAt + 1}/${items.length}` : `批量生成 ${items.length} 张`}
          </button>
        )}

        {err && <div className="gp-err">{err}</div>}
      </div>
    </div>
  )
})

const scriptNodeVersions = createShapePropsMigrationIds('scriptNode', { AddTemplateId: 1, AddTplSel: 2 })

export class ScriptNodeUtil extends BaseBoxShapeUtil<ScriptNodeShape> {
  static override type = 'scriptNode' as const
  static override props: RecordProps<ScriptNodeShape> = {
    w: T.number,
    h: T.number,
    script: T.string,
    items: T.string,
    templateId: T.string,
    tplSel: T.string
  }

  // 给老节点补默认值，避免加载已存画布时校验失败
  static override migrations = createShapePropsMigrationSequence({
    sequence: [
      {
        id: scriptNodeVersions.AddTemplateId,
        up(props: Record<string, unknown>) {
          props.templateId = ''
        }
      },
      {
        id: scriptNodeVersions.AddTplSel,
        up(props: Record<string, unknown>) {
          props.tplSel = '{}'
        }
      }
    ]
  })

  getDefaultProps(): ScriptNodeShape['props'] {
    return { w: SW, h: 600, script: '', items: '[]', templateId: '', tplSel: '{}' }
  }

  component(shape: ScriptNodeShape): JSX.Element {
    return (
      <HTMLContainer
        style={{ width: shape.props.w, height: shape.props.h, overflow: 'visible', pointerEvents: 'all' }}
      >
        <ScriptBody shape={shape} />
      </HTMLContainer>
    )
  }

  override getIndicatorPath(shape: ScriptNodeShape): Path2D {
    const p = new Path2D()
    p.roundRect(0, 0, shape.props.w, shape.props.h, 16)
    return p
  }
}
