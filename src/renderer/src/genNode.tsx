import { createContext, useContext, useState, useRef, useEffect, type ChangeEvent } from 'react'
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  useEditor,
  track,
  stopEventPropagation,
  createShapeId,
  createBindingId,
  createShapePropsMigrationIds,
  createShapePropsMigrationSequence,
  T,
  type TLBaseShape,
  type RecordProps
} from 'tldraw'
import { DEFAULT_TEMPLATES, type PromptTemplate } from './promptConfig'
import { MentionInput } from './MentionInput'
import { composePrompt, type NamedPrompt } from './presets'
import { ResizeHandle } from './nodeResize'

export type GenNodeShape = TLBaseShape<
  'genNode',
  {
    w: number
    h: number
    src: string
    title: string // 名称
    aliases: string // 别名
    prompt: string // 描述（也是出图提示词）
    model: string
    size: string
    refs: string // 参考图（JSON 字符串数组，多张无上限）
    styleName: string // 选中的风格预设名
    typeName: string // 选中的资产类型预设名
    status: string // 'idle' | 'loading' | 'error'
    error: string
  }
>

export interface GenCtx {
  baseURL: string
  apiKey: string
  imageModels: string[]
  textModels: string[]
  defaultModel: string
  defaultSize: string
  apiType: 'openai' | 'task521'
  // 视频生成端点（可与图片不同站）
  videoBaseURL: string
  videoApiKey: string
  videoApiType: 'openai' | 'task521'
  videoModels: string[]
  videoModel: string
  templates: PromptTemplate[]
  // 视频反推接口（Qwen/DashScope）
  revBaseURL: string
  revApiKey: string
  revModel: string
  revFps: number
  // 资产生成配置：风格 / 资产类型 预设
  styles: NamedPrompt[]
  assetTypes: NamedPrompt[]
  openSettings: (tab?: string) => void
  openTemplates: () => void
  requestUpload: (nodeId: string) => void
  pickAssets: (onPick: (srcs: string[]) => void) => void
  startConnect: (fromId: string, sx: number, sy: number, dir: 'in' | 'out') => void
  openLightbox: (src: string) => void
  openCrop: (src: string, onApply: (newSrc: string) => void) => void
  openAnnotate: (src: string, onApply: (newSrc: string) => void) => void
}

export const GenContext = createContext<GenCtx>({
  baseURL: '',
  apiKey: '',
  imageModels: [],
  textModels: [],
  defaultModel: 'gpt-image-2',
  defaultSize: '1024x1024',
  apiType: 'openai',
  videoBaseURL: '',
  videoApiKey: '',
  videoApiType: 'openai',
  videoModels: [],
  videoModel: '',
  templates: DEFAULT_TEMPLATES,
  revBaseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  revApiKey: '',
  revModel: 'qwen-vl-max',
  revFps: 2,
  styles: [],
  assetTypes: [],
  openSettings: () => {},
  openTemplates: () => {},
  requestUpload: () => {},
  pickAssets: () => {},
  startConnect: () => {},
  openLightbox: () => {},
  openCrop: () => {},
  openAnnotate: () => {}
})

// 参考图存为 JSON 字符串（避免 tldraw 数组校验/迁移复杂度）；多张无上限
export function parseRefs(s: string): string[] {
  try {
    const a = JSON.parse(s || '[]')
    return Array.isArray(a) ? a.filter((x) => typeof x === 'string' && x) : []
  } catch {
    return []
  }
}

// 多选本地图片 → data URL 数组
export function readImageFiles(files: FileList | null): Promise<string[]> {
  const list = Array.from(files || []).filter((f) => f.type.startsWith('image/'))
  return Promise.all(
    list.map(
      (f) =>
        new Promise<string>((res) => {
          const fr = new FileReader()
          fr.onload = () => res(fr.result as string)
          fr.onerror = () => res('')
          fr.readAsDataURL(f)
        })
    )
  ).then((arr) => arr.filter(Boolean))
}

const ASPECTS = [
  { label: '1:1', size: '1024x1024' },
  { label: '横 3:2', size: '1536x1024' },
  { label: '竖 2:3', size: '1024x1536' },
  { label: '自动', size: 'auto' }
]

const NODE_W = 300

// size 字符串(如 1024x1024 / 1792x1024 / auto) → 521 接口的 aspect_ratio
function ratio521(size: string): string {
  const m = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(String(size || '').trim())
  if (!m) return 'auto'
  const w = +m[1]
  const h = +m[2]
  if (!w || !h) return 'auto'
  const r = w / h
  const cands: Array<[string, number]> = [
    ['1:1', 1],
    ['16:9', 16 / 9],
    ['9:16', 9 / 16],
    ['4:3', 4 / 3],
    ['3:4', 3 / 4],
    ['3:2', 3 / 2],
    ['2:3', 2 / 3],
    ['21:9', 21 / 9],
    ['9:21', 9 / 21]
  ]
  let best = '1:1'
  let bestD = Infinity
  for (const [name, val] of cands) {
    const d = Math.abs(val - r)
    if (d < bestD) {
      bestD = d
      best = name
    }
  }
  return best
}

function loadDim(src: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve({ w: img.naturalWidth || 1024, h: img.naturalHeight || 1024 })
    img.onerror = () => resolve({ w: 1024, h: 1024 })
    img.src = src
  })
}

const genNodeVersions = createShapePropsMigrationIds('genNode', {
  AddTitleAliases: 1,
  AddRefs: 2,
  AddPresets: 3
})

export class GenNodeUtil extends BaseBoxShapeUtil<GenNodeShape> {
  static override type = 'genNode' as const
  static override props: RecordProps<GenNodeShape> = {
    w: T.number,
    h: T.number,
    src: T.string,
    title: T.string,
    aliases: T.string,
    prompt: T.string,
    model: T.string,
    size: T.string,
    refs: T.string,
    styleName: T.string,
    typeName: T.string,
    status: T.string,
    error: T.string
  }

  // 给已存画布里的老节点补默认值，避免加载时校验失败
  static override migrations = createShapePropsMigrationSequence({
    sequence: [
      {
        id: genNodeVersions.AddTitleAliases,
        up(props: Record<string, unknown>) {
          props.title = ''
          props.aliases = ''
        }
      },
      {
        id: genNodeVersions.AddRefs,
        up(props: Record<string, unknown>) {
          props.refs = '[]'
        }
      },
      {
        id: genNodeVersions.AddPresets,
        up(props: Record<string, unknown>) {
          props.styleName = ''
          props.typeName = ''
        }
      }
    ]
  })

  getDefaultProps(): GenNodeShape['props'] {
    return {
      w: NODE_W,
      h: NODE_W,
      src: '',
      title: '',
      aliases: '',
      prompt: '',
      model: 'gpt-image-2',
      size: '1024x1024',
      refs: '[]',
      styleName: '',
      typeName: '',
      status: 'idle',
      error: ''
    }
  }

  // BaseBoxShapeUtil 已提供 getGeometry / getIndicatorPath / onResize（基于 w,h）

  component(shape: GenNodeShape): JSX.Element {
    return (
      <HTMLContainer
        style={{ width: shape.props.w, height: shape.props.h, overflow: 'visible', pointerEvents: 'all' }}
      >
        <NodeBody shape={shape} />
      </HTMLContainer>
    )
  }

  override getIndicatorPath(shape: GenNodeShape): Path2D {
    const p = new Path2D()
    p.roundRect(0, 0, shape.props.w, shape.props.h, 14)
    return p
  }
}

// 原始模型 id → 友好显示名（基于 geeknow 真实列表）
export function prettifyModel(id: string): string {
  const raw = id.replace(/\s*\[[^\]]*\]\s*/g, '').trim()
  let m = raw.match(/^mj_(fast|relax|turbo)_imagine$/i)
  if (m) {
    const t = { fast: 'Fast', relax: 'Relax', turbo: 'Turbo' }[m[1].toLowerCase()] || m[1]
    return `Midjourney · ${t}`
  }
  m = raw.match(/^gpt-image-(.+)$/i)
  if (m) return `GPT Image ${m[1].replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}`
  m = raw.match(/^doubao-seedream-(\d+)-(\d+)/i)
  if (m) return `Seedream ${m[1]}.${m[2]}`
  m = raw.match(/^gemini-([\d.]+)-(flash|pro)/i)
  if (m) return `Gemini ${m[1]} ${m[2][0].toUpperCase()}${m[2].slice(1)}`
  return raw
    .replace(/-image(-preview)?$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim()
}

function modelBadge(m: string): string {
  const s = m.toLowerCase()
  if (/4k/.test(s)) return '4K'
  if (/2k/.test(s)) return '2K'
  if (/1080/.test(s)) return '1080P'
  if (/-pro|_pro|\bpro\b/.test(s)) return 'PRO'
  return ''
}

// 精选模型选择器（搜索式弹窗，仿 TapNow）
export function ModelPicker({
  value,
  models,
  onChange
}: {
  value: string
  models: string[]
  onChange: (m: string) => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: PointerEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', h, true)
    return () => window.removeEventListener('pointerdown', h, true)
  }, [open])
  const list = models.filter((m) =>
    (m + ' ' + prettifyModel(m)).toLowerCase().includes(q.toLowerCase())
  )
  return (
    <div className="mp" ref={ref} onPointerDown={stopEventPropagation}>
      <button className="mp-btn" onClick={() => setOpen((o) => !o)} title="选择模型">
        <span className="mp-ic">◧</span>
        <span className="mp-val">{value ? prettifyModel(value) : '选择模型'}</span>
        <span className="mp-caret">⌄</span>
      </button>
      {open && (
        <div className="mp-pop">
          <input
            className="mp-search"
            autoFocus
            placeholder="搜索模型…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
          <div className="mp-list">
            {list.length ? (
              list.map((m) => (
                <button
                  key={m}
                  className={'mp-row' + (m === value ? ' on' : '')}
                  onClick={() => {
                    onChange(m)
                    setOpen(false)
                    setQ('')
                  }}
                >
                  <span className="mp-text">
                    <span className="mp-name">{prettifyModel(m)}</span>
                    <span className="mp-sub">{m}</span>
                  </span>
                  {modelBadge(m) && <span className="mp-badge">{modelBadge(m)}</span>}
                  {m === value && <span className="mp-check">✓</span>}
                </button>
              ))
            ) : (
              <div className="mp-empty">无匹配模型（去 ⚙ 设置里拉取）</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const RATIOS = [
  { label: '1:1', size: '1024x1024', vw: 17, vh: 17 },
  { label: '横 16:9', size: '1280x720', vw: 24, vh: 13 },
  { label: '竖 9:16', size: '720x1280', vw: 13, vh: 24 },
  { label: '横 4:3', size: '1152x864', vw: 21, vh: 16 },
  { label: '竖 3:4', size: '864x1152', vw: 16, vh: 21 },
  { label: '横 3:2', size: '1536x1024', vw: 22, vh: 15 },
  { label: '竖 2:3', size: '1024x1536', vw: 15, vh: 22 },
  { label: '自动', size: 'auto', vw: 17, vh: 17 }
]

// 可视化比例选择器（横/竖/方 预览，仿 TapNow）
function RatioPicker({ value, onChange }: { value: string; onChange: (s: string) => void }): JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: PointerEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', h, true)
    return () => window.removeEventListener('pointerdown', h, true)
  }, [open])
  const cur = RATIOS.find((r) => r.size === value) || RATIOS[0]
  return (
    <div className="rp" ref={ref} onPointerDown={stopEventPropagation}>
      <button className="rp-btn" onClick={() => setOpen((o) => !o)} title="比例">
        <span className="rp-box" style={{ width: cur.vw, height: cur.vh }} />
        <span>{cur.label}</span>
        <span className="mp-caret">⌄</span>
      </button>
      {open && (
        <div className="rp-pop">
          {RATIOS.map((r) => (
            <button
              key={r.label}
              className={'rp-row' + (r.size === value ? ' on' : '')}
              onClick={() => {
                onChange(r.size)
                setOpen(false)
              }}
            >
              <span className="rp-box" style={{ width: r.vw, height: r.vh }} />
              <span className="rp-name">{r.label}</span>
              {r.size === value && <span className="mp-check">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const NodeBody = track(function NodeBody({ shape }: { shape: GenNodeShape }) {
  const editor = useEditor()
  const ctx = useContext(GenContext)
  const p = shape.props
  const selected = editor.getSelectedShapeIds().includes(shape.id)
  const [prompt, setPrompt] = useState(p.prompt)
  const [title, setTitle] = useState(p.title)
  const [model, setModel] = useState(p.model)
  const [size, setSize] = useState(p.size)
  const upFileRef = useRef<HTMLInputElement | null>(null)
  const styleName = p.styleName
  const typeName = p.typeName
  const [genErr, setGenErr] = useState('') // 生成器自身的校验提示（不改节点状态）

  const set = (patch: Partial<GenNodeShape['props']>): void =>
    editor.updateShape<GenNodeShape>({ id: shape.id, type: 'genNode', props: patch })

  // 老的「图片生成」编辑框可能只有 360 宽，加载时补到 460×360（和视频一样大）
  useEffect(() => {
    if (!p.src && p.status === 'idle' && (p.w < 460 || p.h < 360)) {
      set({ w: Math.max(p.w, 460), h: Math.max(p.h, 360) })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 手动附加的参考图（上传 / 素材库）
  const attached = parseRefs(p.refs)
  const addRefs = (srcs: string[]): void => {
    if (srcs.length) set({ refs: JSON.stringify([...parseRefs(p.refs), ...srcs]) })
  }
  const removeRef = (i: number): void => {
    const a = parseRefs(p.refs)
    a.splice(i, 1)
    set({ refs: JSON.stringify(a) })
  }
  const onUploadRefs = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const srcs = await readImageFiles(e.target.files)
    e.target.value = ''
    addRefs(srcs)
  }

  // 收集连进本节点的上游参考图（带名称）
  function upstreamRefs(): { url: string; name: string }[] {
    const out: { url: string; name: string }[] = []
    try {
      const toB = editor.getBindingsToShape(shape.id, 'arrow') as any[]
      for (const b of toB) {
        if (b.props?.terminal !== 'end') continue
        const fromB = editor.getBindingsFromShape(b.fromId, 'arrow') as any[]
        for (const s of fromB) {
          if (s.props?.terminal !== 'start') continue
          const src = editor.getShape(s.toId) as any
          if (src && src.type === 'genNode' && src.props.src) {
            out.push({ url: src.props.src as string, name: (src.props.title || '').trim() })
          }
        }
      }
    } catch {
      /* ignore */
    }
    return out
  }

  // 生成器(无图)始终查上游连线，连进来的参考图随时显示；结果图仅选中时查
  const upRefs = !p.src || selected ? upstreamRefs() : []

  // @ 提及可选图片：手动附加 + 上游连线（按节点名）
  const mentionItems = [
    ...attached.map((url, i) => ({ key: 'a' + i, name: `参考${i + 1}`, thumb: url })),
    ...upRefs.map((r, i) => ({ key: 'u' + i, name: r.name || `图片${i + 1}`, thumb: r.url }))
  ]

  async function run(): Promise<void> {
    if (!ctx.apiKey) {
      setGenErr('请先在设置里填入 API 令牌')
      ctx.openSettings('image')
      return
    }
    // 拼接风格 + 资产类型预设
    const stylePrompt = ctx.styles.find((s) => s.name === styleName)?.prompt || ''
    const typePrompt = ctx.assetTypes.find((t) => t.name === typeName)?.prompt || ''
    const finalPrompt = composePrompt(prompt, stylePrompt, typePrompt)
    // 参考图 = 手动附加（上传/素材库）+ 上游连线 + 自身（若有）
    const refs = [...parseRefs(p.refs), ...upstreamRefs().map((r) => r.url)]
    if (refs.length === 0 && p.src) refs.push(p.src)
    if (!finalPrompt.trim() && refs.length === 0) {
      setGenErr('请输入提示词或选择资产类型')
      return
    }
    setGenErr('')
    set({ prompt })

    // 生成结果"连出"一个新节点（每点一次多一张，按已有输出数往下错开），原节点当生成器
    const b = editor.getShapePageBounds(shape)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toB = editor.getBindingsToShape(shape.id, 'arrow') as any[]
    const outCount = toB.filter((bd) => bd.props?.terminal === 'start').length
    const rid = createShapeId()
    editor.createShape<GenNodeShape>({
      id: rid,
      type: 'genNode',
      x: (b?.maxX ?? shape.x) + 80,
      y: (b?.minY ?? shape.y) + outCount * (NODE_W + 30),
      // 把这次生成的请求存到结果节点上，失败时可在结果节点直接「重试」
      props: {
        w: NODE_W,
        h: NODE_W,
        status: 'loading',
        model,
        size,
        title: typeName || '',
        prompt: finalPrompt,
        refs: JSON.stringify(refs)
      }
    })
    try {
      const arrowId = createShapeId()
      editor.createShape({ id: arrowId, type: 'arrow', isLocked: true, props: { color: 'white' } })
      editor.createBindings([
        {
          id: createBindingId(),
          type: 'arrow',
          fromId: arrowId as never,
          toId: shape.id as never,
          props: { terminal: 'start', normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false }
        },
        {
          id: createBindingId(),
          type: 'arrow',
          fromId: arrowId as never,
          toId: rid as never,
          props: { terminal: 'end', normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false }
        }
      ])
    } catch {
      /* ignore */
    }
    const setR = (patch: Partial<GenNodeShape['props']>): void =>
      editor.updateShape<GenNodeShape>({ id: rid, type: 'genNode', props: patch })

    try {
      let src = ''
      if (ctx.apiType === 'task521' || /521xxz\.com/i.test(ctx.baseURL)) {
        const r = await window.api.task521Image({
          baseURL: ctx.baseURL,
          apiKey: ctx.apiKey,
          model,
          prompt: finalPrompt,
          aspectRatio: ratio521(size),
          imageUrls: refs
        })
        src = r.url || ''
      } else if (refs.length === 0) {
        const res = await window.api.generateImage({
          baseURL: ctx.baseURL,
          apiKey: ctx.apiKey,
          model,
          prompt: finalPrompt,
          size,
          n: 1
        })
        src = res[0]?.b64 ? `data:image/png;base64,${res[0].b64}` : res[0]?.url || ''
      } else {
        const useModel = /gemini|banana/i.test(model) ? model : 'gemini-2.5-flash-image'
        const r = await window.api.imageChat({
          baseURL: ctx.baseURL,
          apiKey: ctx.apiKey,
          model: useModel,
          prompt: finalPrompt,
          images: refs
        })
        src = r.b64 ? `data:image/png;base64,${r.b64}` : r.url || ''
      }
      if (!src) throw new Error('未返回图片')
      const dim = await loadDim(src)
      setR({ src, status: 'idle', w: NODE_W, h: Math.round((NODE_W * dim.h) / dim.w) })
    } catch (e) {
      setR({ status: 'error', error: (e as Error).message })
    }
  }

  // 失败后在结果节点上「重试」：用存在自己身上的请求重新生成、填回本节点
  async function regenSelf(): Promise<void> {
    if (!ctx.apiKey) {
      ctx.openSettings('image')
      return
    }
    const refsArr = parseRefs(p.refs)
    set({ status: 'loading', error: '' })
    try {
      let src = ''
      if (ctx.apiType === 'task521' || /521xxz\.com/i.test(ctx.baseURL)) {
        const r = await window.api.task521Image({
          baseURL: ctx.baseURL,
          apiKey: ctx.apiKey,
          model: p.model,
          prompt: p.prompt,
          aspectRatio: ratio521(p.size),
          imageUrls: refsArr
        })
        src = r.url || ''
      } else if (refsArr.length === 0) {
        const res = await window.api.generateImage({
          baseURL: ctx.baseURL,
          apiKey: ctx.apiKey,
          model: p.model,
          prompt: p.prompt,
          size: p.size,
          n: 1
        })
        src = res[0]?.b64 ? `data:image/png;base64,${res[0].b64}` : res[0]?.url || ''
      } else {
        const useModel = /gemini|banana/i.test(p.model) ? p.model : 'gemini-2.5-flash-image'
        const r = await window.api.imageChat({
          baseURL: ctx.baseURL,
          apiKey: ctx.apiKey,
          model: useModel,
          prompt: p.prompt,
          images: refsArr
        })
        src = r.b64 ? `data:image/png;base64,${r.b64}` : r.url || ''
      }
      if (!src) throw new Error('未返回图片')
      const dim = await loadDim(src)
      set({ src, status: 'idle', error: '', w: NODE_W, h: Math.round((NODE_W * dim.h) / dim.w) })
    } catch (e) {
      set({ status: 'error', error: (e as Error).message })
    }
  }

  function duplicateNode(): void {
    const id = createShapeId()
    editor.createShape({ id, type: 'genNode', x: shape.x + 36, y: shape.y + 36, props: { ...p } })
    editor.select(id)
  }
  function removeNode(): void {
    editor.deleteShapes([shape.id])
  }
  async function downloadImage(): Promise<void> {
    if (!p.src) return
    if (p.src.startsWith('data:')) {
      const b64 = p.src.split(',')[1]
      if (b64) await window.api.saveImage({ b64, defaultName: `image-${Date.now()}.png` })
    } else {
      await window.api.saveImage({ url: p.src, defaultName: `image-${Date.now()}.png` })
    }
  }
  // 裁剪 / 标注结果写回本节点
  function applyEdited(newSrc: string): void {
    void loadDim(newSrc).then((d) =>
      set({ src: newSrc, status: 'idle', error: '', w: NODE_W, h: Math.round((NODE_W * d.h) / d.w) })
    )
  }
  // 转绘：在右侧连出一个图片节点，把本图当参考（选风格/资产类型重绘换风格）
  function rerollNode(): void {
    if (!p.src) return
    const b = editor.getShapePageBounds(shape)
    const id = createShapeId()
    editor.createShape<GenNodeShape>({
      id,
      type: 'genNode',
      x: (b?.maxX ?? shape.x) + 80,
      y: b?.minY ?? shape.y
    })
    try {
      const arrowId = createShapeId()
      editor.createShape({ id: arrowId, type: 'arrow', isLocked: true, props: { color: 'white' } })
      editor.createBindings([
        {
          id: createBindingId(),
          type: 'arrow',
          fromId: arrowId as never,
          toId: shape.id as never,
          props: { terminal: 'start', normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false }
        },
        {
          id: createBindingId(),
          type: 'arrow',
          fromId: arrowId as never,
          toId: id as never,
          props: { terminal: 'end', normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false }
        }
      ])
    } catch {
      /* ignore */
    }
    editor.select(id)
  }

  const modelOptions = model && !ctx.imageModels.includes(model) ? [model, ...ctx.imageModels] : ctx.imageModels

  const isGenerator = p.status === 'idle' && !p.src

  const ports = (
    <>
      <button
        className="node-port in"
        onPointerDown={(e) => {
          e.stopPropagation()
          e.preventDefault()
          ctx.startConnect(shape.id, e.clientX, e.clientY, 'in')
        }}
        title="输入：从来源节点拖到这里"
      >
        ＋
      </button>
      <button
        className="node-port out"
        onPointerDown={(e) => {
          e.stopPropagation()
          e.preventDefault()
          ctx.startConnect(shape.id, e.clientX, e.clientY, 'out')
        }}
        title="输出：拖到目标节点连线"
      >
        ＋
      </button>
    </>
  )

  // ===== 生成器：一个编辑框（风格/资产类型 + 参考图 + 提示词 + 生成），点生成连出结果图 =====
  if (isGenerator) {
    return (
      <div className="node node-generator" style={{ width: p.w }} data-selected={selected}>
        <div className="node-drag" title="拖动可移动节点">
          <span className="node-drag-title">✨ 图片生成</span>
          <button className="node-gen-del" onPointerDown={stopEventPropagation} onClick={removeNode} title="删除生成器">
            🗑
          </button>
        </div>
        <div className="node-genbox" onPointerDown={stopEventPropagation} onWheel={(e) => e.stopPropagation()}>
          <div className="node-presets">
            <label className="node-preset">
              <span>风格</span>
              <select value={styleName} onChange={(e) => set({ styleName: e.target.value })}>
                {styleName && !ctx.styles.some((s) => s.name === styleName) && <option value={styleName}>{styleName}</option>}
                {ctx.styles.map((s) => (
                  <option key={s.name} value={s.name}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="node-preset">
              <span>资产类型</span>
              <select value={typeName} onChange={(e) => set({ typeName: e.target.value })}>
                {typeName && !ctx.assetTypes.some((t) => t.name === typeName) && <option value={typeName}>{typeName}</option>}
                {ctx.assetTypes.map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="node-refs">
            <div className="node-refs-head">
              <span className="node-refs-title">
                参考图{attached.length + upRefs.length > 0 ? ` · ${attached.length + upRefs.length} 张` : ''}
              </span>
              <button className="node-refbtn" onClick={() => upFileRef.current?.click()} title="上传图片（可多选）">
                ⬆ 上传
              </button>
              <button className="node-refbtn" onClick={() => ctx.pickAssets(addRefs)} title="从素材库选择（可多选）">
                📦 素材库
              </button>
              <input ref={upFileRef} type="file" accept="image/*" multiple hidden onChange={onUploadRefs} />
            </div>
            {(attached.length > 0 || upRefs.length > 0) && (
              <div className="node-refthumbs">
                {attached.map((src, i) => (
                  <span className="node-refthumb" key={'a' + i}>
                    <img src={src} alt="" />
                    <button className="node-refx" title="移除" onClick={() => removeRef(i)}>
                      ×
                    </button>
                  </span>
                ))}
                {upRefs.map((r, i) => (
                  <span className="node-refthumb node-refthumb-link" key={'u' + i} title={`来自连线「${r.name || '图片' + (i + 1)}」（在源节点处管理）`}>
                    <img src={r.url} alt="" />
                    <span className="node-reflink">链</span>
                  </span>
                ))}
              </div>
            )}
          </div>
          <MentionInput
            className="node-prompt"
            value={prompt}
            items={mentionItems}
            placeholder="描述你想生成的画面…（输入 @ 引用图片，回车生成）"
            onChange={setPrompt}
            onEnter={() => void run()}
          />
          <div className="node-row">
            <ModelPicker value={model} models={ctx.imageModels} onChange={setModel} />
            <RatioPicker value={size} onChange={setSize} />
            <button className="node-send" onClick={() => void run()} title="生成">
              ↑
            </button>
          </div>
          {genErr && <div className="node-err">{genErr}</div>}
        </div>
        {ports}
        <ResizeHandle editor={editor} shapeId={shape.id} minW={380} minH={300} />
      </div>
    )
  }

  // ===== 结果图：图片 + 上方胶囊工具条（裁剪/标注/复制/转绘/下载/删除）=====
  return (
    <div className="node" style={{ width: p.w, height: p.h }} data-selected={selected}>
      <div className="node-label">
        <span className="node-label-ico">🖼</span>
        <input
          className="node-label-edit"
          value={title}
          placeholder="未命名"
          onPointerDown={stopEventPropagation}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => set({ title })}
        />
      </div>

      <div className="node-img">
        {p.status === 'loading' ? (
          <div className="node-spin" />
        ) : p.status === 'error' ? (
          <div className="node-errbox" onPointerDown={stopEventPropagation}>
            <div className="node-errmsg" title={p.error}>
              ⚠ {p.error}
            </div>
            <button className="node-retry" onClick={() => void regenSelf()}>
              ↻ 重试
            </button>
          </div>
        ) : (
          <img
            src={p.src}
            draggable={false}
            alt=""
            onDoubleClick={(e) => {
              e.stopPropagation()
              ctx.openLightbox(p.src)
            }}
          />
        )}
      </div>

      {p.src && (
        <div className="node-tools" onPointerDown={stopEventPropagation}>
          <button onClick={() => ctx.openCrop(p.src, applyEdited)} title="裁剪">
            <span className="tt-ic">⛶</span> 裁剪
          </button>
          <button onClick={() => ctx.openAnnotate(p.src, applyEdited)} title="标注">
            <span className="tt-ic">✎</span> 标注
          </button>
          <button onClick={duplicateNode} title="复制">
            <span className="tt-ic">⧉</span> 复制
          </button>
          <button onClick={rerollNode} title="转绘（以本图为参考新建图片节点重绘/换风格）">
            <span className="tt-ic">🎨</span> 转绘
          </button>
          <button onClick={downloadImage} title="下载">
            <span className="tt-ic">⬇</span> 下载
          </button>
          <button className="tt-del" onClick={removeNode} title="删除">
            <span className="tt-ic">🗑</span> 删除
          </button>
        </div>
      )}
      {ports}
      <ResizeHandle editor={editor} shapeId={shape.id} minW={100} minH={80} />
    </div>
  )
})
