import { useEffect, useRef, useState } from 'react'
import {
  Tldraw,
  Editor,
  AssetRecordType,
  createShapeId,
  createBindingId,
  toRichText,
  track,
  react,
  type TLComponents
} from 'tldraw'
import 'tldraw/tldraw.css'
import './styles.css'
import { GenNodeUtil, GenContext, ModelPicker, prettifyModel } from './genNode'
import { ScriptNodeUtil } from './scriptNode'
import { VideoPromptUtil } from './videoPromptNode'
import { VideoGenUtil } from './videoGenNode'
import { AudioNodeUtil } from './audioNode'
import {
  DEFAULT_TEMPLATES,
  normalizeTemplate,
  templateFromLegacy,
  withOfficialTemplates,
  type PromptTemplate
} from './promptConfig'
import { TemplateManager } from './TemplateManager'
import { AssetLibrary } from './AssetLibrary'
import { type Asset } from './assets'
import { HomePage } from './HomePage'
import { UsageLog } from './UsageLogModal'
import { DEFAULT_STYLES, DEFAULT_ASSET_TYPES, type NamedPrompt } from './presets'
import { CropModal } from './CropModal'
import { AnnotateModal } from './AnnotateModal'
import { type Project, type ProjectKind, loadProjects, saveProjects, newId, persistKey } from './projects'

const LS_KEY = 'ai-canvas-settings'

// 按「能力」分区，每个能力一个独立端点：地址 + 密钥 + 接口类型 + 手动维护的模型清单 + 默认模型。
// api: 'openai' 标准 OpenAI 同步接口；'task521' 521.AI 异步任务接口(/v1/videos 提交+轮询)。
type ApiType = 'openai' | 'task521'
interface Endpoint {
  name: string // 渠道名（如 521）——展示用，地址/接口类型在代码里配好
  baseURL: string
  apiKey: string
  api: ApiType
  models: string[]
  model: string // 选中的模型
}
// 转绘（视频反推）端点：固定走对话/视觉接口，多一个抽帧 fps
interface RevEndpoint {
  baseURL: string
  apiKey: string
  model: string
  fps: number
}

interface Settings {
  image: Endpoint // 图片生成
  video: Endpoint // 视频生成
  voice: Endpoint // 大语音模型（配音 / TTS）
  reverse: RevEndpoint // 转绘（视频反推）
  chatModels: string[] // 剧本提取用对话模型（复用图片端点的地址/密钥）
  chatModel: string
  size: string
  templates: PromptTemplate[]
  videoKeys: Record<string, string> // 各视频服务商各自的密钥（按 provider id）
  styles: NamedPrompt[] // 资产生成配置：风格预设
  assetTypes: NamedPrompt[] // 资产生成配置：资产类型预设
}

// 视频服务商预设：切换即换 地址/模型清单/接口类型，密钥各自保存
const VIDEO_PROVIDERS = [
  { id: '521', name: '521.AI', baseURL: 'https://www.521xxz.com', models: ['521ai-SD', 'grok-imagine-video-1.5-preview'] },
  { id: 'geeknow', name: 'GeekNow（manxue-2.0）', baseURL: 'https://api.geeknow.ai', models: ['manxue-2.0', 'grok-imagine-video-1.5-preview'] }
]
const videoProviderOf = (url: string): string => (/geeknow\./i.test(url) ? 'geeknow' : '521')

const DEFAULTS: Settings = {
  image: {
    name: '521',
    baseURL: 'https://www.521xxz.com',
    apiKey: '',
    api: 'task521',
    models: ['gpt-image-2-2K', 'gemini-3.1-flash-image-preview4K'],
    model: 'gpt-image-2-2K'
  },
  video: {
    name: '521',
    baseURL: 'https://www.521xxz.com',
    apiKey: '',
    api: 'task521',
    models: ['521ai-SD', 'grok-imagine-video-1.5-preview'],
    model: '521ai-SD'
  },
  voice: { name: '', baseURL: '', apiKey: '', api: 'openai', models: [], model: '' },
  reverse: { baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiKey: '', model: 'qwen-vl-max', fps: 2 },
  chatModels: [],
  chatModel: '',
  size: '1024x1024',
  templates: DEFAULT_TEMPLATES,
  videoKeys: {},
  styles: DEFAULT_STYLES,
  assetTypes: DEFAULT_ASSET_TYPES
}

function hostName(url: string): string {
  return (url || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '')
}

const is521 = (url: string): boolean => /521xxz\.com/i.test(url || '')

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normEndpoint(e: any, def: Endpoint): Endpoint {
  if (!e || typeof e !== 'object') return { ...def }
  const baseURL = typeof e.baseURL === 'string' ? e.baseURL : def.baseURL
  return {
    name: typeof e.name === 'string' && e.name ? e.name : def.name || hostName(baseURL),
    baseURL,
    apiKey: typeof e.apiKey === 'string' ? e.apiKey : '',
    // 521.AI 一律走异步任务接口；其余按保存值
    api: e.api === 'task521' || is521(baseURL) ? 'task521' : 'openai',
    models: Array.isArray(e.models) ? e.models : [],
    model: typeof e.model === 'string' ? e.model : ''
  }
}

type GenType = 'image' | 'text' | 'video'
interface Point {
  x: number
  y: number
}

const SHAPE_UTILS = [GenNodeUtil, ScriptNodeUtil, VideoPromptUtil, VideoGenUtil, AudioNodeUtil]

const TLDRAW_COMPONENTS: TLComponents = {
  Toolbar: null,
  StylePanel: null,
  QuickActions: null,
  ActionsMenu: null,
  PageMenu: null,
  MainMenu: null,
  HelpMenu: null,
  ContextMenu: null
}

function defaultTemplates(): PromptTemplate[] {
  return DEFAULT_TEMPLATES.map((t) => ({ ...t }))
}

function loadSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(LS_KEY) || '{}')
    let templates: PromptTemplate[]
    if (Array.isArray(saved.templates) && saved.templates.length) {
      // 规范化（含从老的 cats 结构迁移）+ 官方模板始终刷新为代码最新版，用户自建保留
      templates = withOfficialTemplates(saved.templates.map(normalizeTemplate))
    } else if (saved.promptCfg) {
      // 迁移旧的单一 promptCfg → 一条用户模板 + 官方模板
      const migrated = templateFromLegacy({ ...saved.promptCfg, name: '我的旧模板' })
      templates = withOfficialTemplates([migrated])
    } else {
      templates = defaultTemplates()
    }

    let image: Endpoint
    let video: Endpoint
    let chatModels: string[]
    if (saved.image || saved.video) {
      // 已是新版「分能力端点」格式
      image = normEndpoint(saved.image, DEFAULTS.image)
      video = normEndpoint(saved.video, DEFAULTS.video)
      chatModels = Array.isArray(saved.chatModels) ? saved.chatModels : []
    } else if (Array.isArray(saved.channels) && saved.channels.length) {
      // 从「渠道」格式迁移：取激活渠道的地址/密钥 → 图片 + 视频端点
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const act = saved.channels.find((c: any) => c.id === saved.activeId) || saved.channels[0]
      const api: ApiType = act.api === 'task521' || is521(act.baseURL) ? 'task521' : 'openai'
      const imgModels = Array.isArray(act.imageModels) && act.imageModels.length ? act.imageModels : DEFAULTS.image.models
      const vidModels = Array.isArray(act.videoModels) && act.videoModels.length ? act.videoModels : DEFAULTS.video.models
      const nm = act.name || (is521(act.baseURL) ? '521' : hostName(act.baseURL)) || '渠道'
      image = { name: nm, baseURL: act.baseURL || DEFAULTS.image.baseURL, apiKey: act.apiKey || '', api, models: imgModels, model: saved.imageModel || imgModels[0] || '' }
      video = { name: nm, baseURL: act.baseURL || DEFAULTS.video.baseURL, apiKey: act.apiKey || '', api, models: vidModels, model: saved.videoModel || vidModels[0] || '' }
      chatModels = Array.isArray(act.chatModels) ? act.chatModels : []
    } else {
      image = { ...DEFAULTS.image }
      video = { ...DEFAULTS.video }
      chatModels = []
      // 极旧版单一 baseURL/apiKey：保留 key 到图片端点
      if (saved.baseURL && saved.apiKey) {
        image = { ...image, baseURL: saved.baseURL, apiKey: saved.apiKey, api: 'openai' }
        video = { ...video, baseURL: saved.baseURL, apiKey: saved.apiKey, api: 'openai' }
      }
    }

    const voice = normEndpoint(saved.voice, DEFAULTS.voice)
    const reverse: RevEndpoint = {
      baseURL: saved.reverse?.baseURL || saved.revBaseURL || DEFAULTS.reverse.baseURL,
      apiKey: saved.reverse?.apiKey || saved.revApiKey || '',
      model: saved.reverse?.model || saved.revModel || DEFAULTS.reverse.model,
      fps: Number(saved.reverse?.fps ?? saved.revFps) || DEFAULTS.reverse.fps
    }

    // 各视频服务商密钥：保留已存的，并把当前 video.apiKey 归到它所属服务商
    const videoKeys: Record<string, string> =
      saved.videoKeys && typeof saved.videoKeys === 'object' ? { ...saved.videoKeys } : {}
    if (video.apiKey && !videoKeys[videoProviderOf(video.baseURL)]) {
      videoKeys[videoProviderOf(video.baseURL)] = video.apiKey
    }

    const styles: NamedPrompt[] = Array.isArray(saved.styles) && saved.styles.length ? saved.styles : DEFAULT_STYLES
    const assetTypes: NamedPrompt[] =
      Array.isArray(saved.assetTypes) && saved.assetTypes.length ? saved.assetTypes : DEFAULT_ASSET_TYPES

    return {
      image,
      video,
      voice,
      reverse,
      chatModels,
      chatModel: saved.chatModel || '',
      size: saved.size || DEFAULTS.size,
      templates,
      videoKeys,
      styles,
      assetTypes
    }
  } catch {
    return { ...DEFAULTS, templates: defaultTemplates() }
  }
}

function loadImageSize(src: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve({ w: img.naturalWidth || 1024, h: img.naturalHeight || 1024 })
    img.onerror = () => resolve({ w: 1024, h: 1024 })
    img.src = src
  })
}

function loadVideoSize(url: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.onloadedmetadata = () => resolve({ w: v.videoWidth || 1280, h: v.videoHeight || 720 })
    v.onerror = () => resolve({ w: 1280, h: 720 })
    v.src = url
  })
}

// 模型清单编辑：彩色 chip + 输入框添加（手动维护，不自动拉取）
function ModelChips(props: {
  models: string[]
  onAdd: (name: string) => void
  onRemove: (name: string) => void
  placeholder?: string
}): JSX.Element {
  const [v, setV] = useState('')
  const add = (): void => {
    props.onAdd(v)
    setV('')
  }
  return (
    <div className="field">
      <div className="chip-row">
        {props.models.length === 0 && <span className="chip-empty">暂无模型，下面添加 ↓</span>}
        {props.models.map((m) => (
          <span className="chip" key={m}>
            {m}
            <button onClick={() => props.onRemove(m)} title="删除">
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="chip-add">
        <input
          value={v}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
          }}
          placeholder={props.placeholder || '输入模型名后回车'}
        />
        <button onClick={add}>添加</button>
      </div>
    </div>
  )
}

// 密钥输入框：带「显示/隐藏」切换
function KeyInput(props: { value: string; onChange: (v: string) => void; placeholder?: string }): JSX.Element {
  const [show, setShow] = useState(false)
  return (
    <div className="key-input">
      <input
        type={show ? 'text' : 'password'}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder || 'sk-...'}
        autoComplete="off"
        spellCheck={false}
      />
      <button type="button" className="key-eye" onClick={() => setShow((s) => !s)} title={show ? '隐藏密钥' : '显示密钥'}>
        {show ? '🙈' : '👁'}
      </button>
    </div>
  )
}

// 一个能力端点的精简配置：渠道名称 + 密钥 + 选择模型（地址/接口类型/模型清单在代码里配好，不在 UI 暴露）
function EndpointSection(props: {
  ep: Endpoint
  onChange: (patch: Partial<Endpoint>) => void
  namePlaceholder?: string
}): JSX.Element {
  const ep = props.ep
  return (
    <>
      <label className="field">
        <span>渠道名称</span>
        <input value={ep.name} onChange={(e) => props.onChange({ name: e.target.value })} placeholder={props.namePlaceholder || '如 521'} />
      </label>
      <label className="field">
        <span>API 密钥</span>
        <KeyInput value={ep.apiKey} onChange={(v) => props.onChange({ apiKey: v })} />
      </label>
      <label className="field">
        <span>选择模型</span>
        <select value={ep.model} onChange={(e) => props.onChange({ model: e.target.value })}>
          {ep.models.length ? (
            ep.models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))
          ) : (
            <option value="">（暂无模型，告诉我要接通哪个）</option>
          )}
        </select>
      </label>
    </>
  )
}

// 视频设置：服务商下拉（521 / GeekNow）+ 各自密钥 + 模型
function VideoSettings(props: {
  video: Endpoint
  videoKeys: Record<string, string>
  onChange: (videoPatch: Partial<Endpoint>, keysPatch?: Record<string, string>) => void
}): JSX.Element {
  const { video, videoKeys } = props
  const provider = videoProviderOf(video.baseURL)
  const cur = VIDEO_PROVIDERS.find((p) => p.id === provider) || VIDEO_PROVIDERS[0]
  const model = cur.models.includes(video.model) ? video.model : cur.models[0]
  const switchProvider = (id: string): void => {
    const prov = VIDEO_PROVIDERS.find((p) => p.id === id) || VIDEO_PROVIDERS[0]
    props.onChange({
      name: prov.name,
      baseURL: prov.baseURL,
      apiKey: videoKeys[id] || '',
      api: 'task521',
      models: prov.models,
      model: prov.models[0]
    })
  }
  return (
    <>
      <label className="field">
        <span>视频服务商</span>
        <select value={provider} onChange={(e) => switchProvider(e.target.value)}>
          {VIDEO_PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>API 密钥</span>
        <KeyInput value={video.apiKey} onChange={(v) => props.onChange({ apiKey: v }, { ...videoKeys, [provider]: v })} />
      </label>
      <label className="field">
        <span>选择模型</span>
        <select value={model} onChange={(e) => props.onChange({ model: e.target.value })}>
          {cur.models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>
      <p className="settings-tip">
        521.AI = seedance / grok；GeekNow manxue-2.0 = 满血版2.0(seedance2)，固定 15s·720p·可真人。两个服务商密钥各自保存，切换不丢。
      </p>
    </>
  )
}

// 一组「名称 + 提示词」可增删改的列表（风格 / 资产类型 共用）
function NamedPromptEditor(props: {
  title: string
  addLabel: string
  items: NamedPrompt[]
  onChange: (items: NamedPrompt[]) => void
}): JSX.Element {
  const { items } = props
  const upd = (i: number, patch: Partial<NamedPrompt>): void =>
    props.onChange(items.map((it, j) => (j === i ? { ...it, ...patch } : it)))
  const del = (i: number): void => props.onChange(items.filter((_, j) => j !== i))
  const add = (): void => props.onChange([...items, { name: '新预设', prompt: '' }])
  return (
    <div className="agcfg-card">
      <div className="agcfg-head">
        <span className="agcfg-title">{props.title}</span>
        <button className="tm-new" onClick={add}>
          ＋ {props.addLabel}
        </button>
      </div>
      <div className="agcfg-list">
        {items.map((it, i) => (
          <div className="agcfg-row" key={i}>
            <input
              className="agcfg-name"
              value={it.name}
              placeholder="名称"
              onChange={(e) => upd(i, { name: e.target.value })}
            />
            <textarea
              className="agcfg-prompt"
              value={it.prompt}
              placeholder="提示词（选中该项时会拼到出图提示词里）"
              onChange={(e) => upd(i, { prompt: e.target.value })}
            />
            <button className="agcfg-del" onClick={() => del(i)} title="删除">
              🗑
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

// 资产生成配置页：风格 + 资产类型
function AssetGenSettings(props: {
  styles: NamedPrompt[]
  assetTypes: NamedPrompt[]
  onChange: (patch: { styles?: NamedPrompt[]; assetTypes?: NamedPrompt[] }) => void
}): JSX.Element {
  return (
    <>
      <p className="settings-tip">自定义生图节点的「风格」和「资产类型」下拉选项及其提示词。选中后会自动拼到出图提示词里。</p>
      <NamedPromptEditor title="风格选项" addLabel="新增风格" items={props.styles} onChange={(s) => props.onChange({ styles: s })} />
      <NamedPromptEditor
        title="资产类型"
        addLabel="新增类型"
        items={props.assetTypes}
        onChange={(a) => props.onChange({ assetTypes: a })}
      />
    </>
  )
}

// 从节点拖到空白处弹出的「引用该节点生成」菜单项（图标 + 标题 + 说明）
const CONNECT_NODE_OPTIONS: {
  k: 'image' | 'video' | 'audio' | 'videoPrompt'
  title: string
  sub: string
  icon: JSX.Element
}[] = [
  {
    k: 'image',
    title: '图片生成',
    sub: '文生图 / 图生图 / 多图融合',
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="16" rx="2.5" />
        <circle cx="8.5" cy="9.5" r="1.6" />
        <path d="M21 16l-5-5L5 20" />
      </svg>
    )
  },
  {
    k: 'video',
    title: '视频生成',
    sub: '参考生视频（节点）',
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="5" width="18" height="14" rx="2.5" />
        <path d="M10 9l5 3-5 3z" fill="currentColor" stroke="none" />
      </svg>
    )
  },
  {
    k: 'audio',
    title: '音频',
    sub: '上传 / 连参考音频',
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 17V5l10-2v12" />
        <circle cx="6.5" cy="17" r="2.5" />
        <circle cx="16.5" cy="15" r="2.5" />
      </svg>
    )
  },
  {
    k: 'videoPrompt',
    title: '视频反推（转绘）',
    sub: '抽帧 → 反推分镜提示词',
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M3 9h18M3 15h18M8 4v16M16 4v16" />
      </svg>
    )
  }
]

export default function App(): JSX.Element {
  const editorRef = useRef<Editor | null>(null)
  const [editor, setEditor] = useState<Editor | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const uploadTargetRef = useRef<string | null>(null)
  const uploadPageRef = useRef<Point | null>(null)
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [error, setError] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [settingsTab, setSettingsTab] = useState<
    'image' | 'video' | 'voice' | 'reverse' | 'assetgen' | null
  >(null)
  const [showTemplates, setShowTemplates] = useState(false)
  const [showAssets, setShowAssets] = useState(false)
  const [showUsage, setShowUsage] = useState(false)
  // 图片裁剪 / 标注编辑器
  const [imgEdit, setImgEdit] = useState<{
    mode: 'crop' | 'annotate'
    src: string
    onApply: (s: string) => void
  } | null>(null)
  // 节点「素材库」按钮打开的多选拾取：存回调，确认后把所选图片回传给该节点
  const assetPickCbRef = useRef<((srcs: string[]) => void) | null>(null)
  const [assetPickMode, setAssetPickMode] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number; page: Point } | null>(null)
  const [panel, setPanel] = useState<{ type: GenType; x: number; y: number; page: Point } | null>(
    null
  )
  const [connectDrag, setConnectDrag] = useState<{
    fromId: string
    sx: number
    sy: number
    x: number
    y: number
    dir: 'in' | 'out'
  } | null>(null)
  // 从节点端口拖到空白处松手 → 弹「添加节点」菜单，选择要连出的节点类型
  const [connectMenu, setConnectMenu] = useState<{
    x: number
    y: number
    page: Point
    fromId: string
    dir: 'in' | 'out'
  } | null>(null)
  const [selectedConn, setSelectedConn] = useState<string | null>(null)
  const [lightbox, setLightbox] = useState<{ src: string } | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [projects, setProjects] = useState<Project[]>(() => {
    const l = loadProjects()
    if (l.length) return l
    const seed: Project[] = [{ id: 'default', name: '我的画布', createdAt: Date.now(), updatedAt: Date.now() }]
    saveProjects(seed)
    return seed
  })
  const [view, setView] = useState<'home' | 'canvas'>('home')
  const [projectId, setProjectId] = useState('default')

  // 各能力端点（手动维护模型，不自动拉取）
  const imgEp = settings.image
  const vidEp = settings.video
  const imageModels = imgEp.models
  const videoModels = vidEp.models
  const textModels = settings.chatModels
  const imageModel = imageModels.includes(imgEp.model) ? imgEp.model : imageModels[0] || ''
  const videoModel = videoModels.includes(vidEp.model) ? vidEp.model : videoModels[0] || ''

  useEffect(() => {
    localStorage.setItem(LS_KEY, JSON.stringify(settings))
  }, [settings])

  // 粘贴图片 → 建图片节点
  useEffect(() => {
    const onPaste = (e: ClipboardEvent): void => {
      const items = e.clipboardData?.items
      if (!items) return
      for (const it of Array.from(items)) {
        if (it.type.startsWith('image/')) {
          const file = it.getAsFile()
          if (file) {
            const reader = new FileReader()
            reader.onload = () => createGenNode(viewportCenter(), reader.result as string)
            reader.readAsDataURL(file)
          }
          e.preventDefault()
          break
        }
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setConnectDrag(null)
        setSelectedConn(null)
        setLightbox(null)
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedConn) {
        const tag = (e.target as HTMLElement | null)?.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA') return
        editorRef.current?.deleteShapes([selectedConn as never])
        setSelectedConn(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedConn])

  // 右键 → 生成菜单（全局捕获，保证立即且稳定弹出，不被 tldraw 吃掉）
  useEffect(() => {
    const onCtx = (e: MouseEvent): void => {
      const t = e.target as HTMLElement | null
      if (
        t &&
        t.closest(
          '.ctxmenu,.genpanel,.modal,.lightbox,.node-composer,.mp-pop,.rp-pop,.topbar,.rail,input,textarea,select'
        )
      )
        return
      e.preventDefault()
      e.stopPropagation()
      const editor = editorRef.current
      const page = editor
        ? (editor.screenToPage({ x: e.clientX, y: e.clientY }) as Point)
        : { x: 0, y: 0 }
      const x = Math.max(8, Math.min(e.clientX, window.innerWidth - 200))
      const y = Math.max(8, Math.min(e.clientY, window.innerHeight - 240))
      setMenu({ x, y, page })
    }
    window.addEventListener('contextmenu', onCtx, true)
    return () => window.removeEventListener('contextmenu', onCtx, true)
  }, [])

  // 拖拽连线：虚线跟手；松手时命中目标节点则建立连接
  useEffect(() => {
    if (!connectDrag) return
    const fromId = connectDrag.fromId
    const dir = connectDrag.dir
    const sx = connectDrag.sx
    const sy = connectDrag.sy
    const move = (e: PointerEvent): void =>
      setConnectDrag((d) => (d ? { ...d, x: e.clientX, y: e.clientY } : d))
    const up = (e: PointerEvent): void => {
      const editor = editorRef.current
      if (editor) {
        try {
          const page = editor.screenToPage({ x: e.clientX, y: e.clientY })
          const hits = editor.getShapesAtPoint(page, { hitInside: true })
          // 可连接的自定义节点（图片 / 视频 / 视频反推 / 音频）
          const CONNECTABLE = new Set(['genNode', 'videoGen', 'videoPrompt', 'audioNode'])
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let target: any = hits.find((s) => CONNECTABLE.has(s.type) && (s.id as string) !== fromId)
          // 吸附：没直接命中就找最近的可连接节点（点到包围盒距离 < 阈值，约 90 屏幕像素）
          if (!target) {
            const tol = 90 / Math.max(0.05, editor.getZoomLevel())
            let bestD = Infinity
            for (const s of editor.getCurrentPageShapes()) {
              if (!CONNECTABLE.has(s.type) || (s.id as string) === fromId) continue
              const bnds = editor.getShapePageBounds(s.id)
              if (!bnds) continue
              const dx = Math.max(bnds.minX - page.x, 0, page.x - bnds.maxX)
              const dy = Math.max(bnds.minY - page.y, 0, page.y - bnds.maxY)
              const d = Math.hypot(dx, dy)
              if (d < bestD) {
                bestD = d
                if (d <= tol) target = s
              }
            }
          }
          // 命中 / 吸附到目标节点 → 直接连；拖到空白处（移动够远）→ 弹「添加节点」菜单选类型
          if (target) {
            const tid = target.id as string
            // 左口(in)=目标作为来源连进自己；右口(out)=自己连到目标
            if (dir === 'in') connectNodes(tid, fromId)
            else connectNodes(fromId, tid)
          } else if (Math.hypot(e.clientX - sx, e.clientY - sy) > 24) {
            setConnectMenu({ x: e.clientX, y: e.clientY, page, fromId, dir })
          }
        } catch {
          /* ignore */
        }
      }
      setConnectDrag(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectDrag?.fromId])

  const update = (patch: Partial<Settings>): void => setSettings((s) => ({ ...s, ...patch }))

  function viewportCenter(): Point {
    const editor = editorRef.current
    if (!editor) return { x: 0, y: 0 }
    const b = editor.getViewportPageBounds()
    return { x: b.x + b.w / 2 - 150, y: b.y + b.h / 2 - 150 }
  }

  function createGenNode(page: Point, src = ''): string | null {
    const editor = editorRef.current
    if (!editor) return null
    // 有图（上传/插入）→ 约视口宽 22% 夹在 180~300；无图（生成器）→ 编辑框（和视频一样大）
    const vb = editor.getViewportPageBounds()
    const base = src ? Math.round(Math.min(300, Math.max(180, vb.w * 0.22))) : 460
    const id = createShapeId()
    editor.createShape({
      id,
      type: 'genNode',
      x: page.x,
      y: page.y,
      props: { w: base, h: src ? base : 360, src, prompt: '', model: imageModel, size: settings.size, status: 'idle', error: '' }
    })
    editor.select(id)
    editor.setCurrentTool('select')
    if (src) {
      // 缩放进 base×base 盒子，长边 = base，竖图不再拉得过高
      void loadImageSize(src).then((d) =>
        editor.updateShape({
          id,
          type: 'genNode',
          props: {
            w: d.w >= d.h ? base : Math.round((base * d.w) / d.h),
            h: d.w >= d.h ? Math.round((base * d.h) / d.w) : base
          }
        })
      )
    }
    return id as string
  }

  // 右键/左栏「剧本批量生成」→ 在画布上放一个剧本节点（常驻，不是弹窗）
  function createScriptNodeShape(page: Point): void {
    const editor = editorRef.current
    if (!editor) return
    const id = createShapeId()
    editor.createShape({ id, type: 'scriptNode', x: page.x, y: page.y })
    editor.select(id)
    editor.setCurrentTool('select')
  }

  // 放一个「视频生成」节点（TapNow 式：提示词 + 模型/比例/分辨率/时长 + 发送）
  function createVideoGenNode(page: Point): void {
    const editor = editorRef.current
    if (!editor) return
    const id = createShapeId()
    editor.createShape({ id, type: 'videoGen', x: page.x, y: page.y, props: { model: videoModel } })
    editor.select(id)
    editor.setCurrentTool('select')
  }

  // 转绘：放一个「视频反推」节点（上传视频 → 抽帧 → 反推提示词）
  function createVideoPromptNode(page: Point): void {
    const editor = editorRef.current
    if (!editor) return
    const id = createShapeId()
    editor.createShape({ id, type: 'videoPrompt', x: page.x, y: page.y })
    editor.select(id)
    editor.setCurrentTool('select')
  }

  // 放一个「音频」节点（上传音频 / 素材库选音频 → 连线到视频节点当参考音频）
  function createAudioNode(page: Point, src = ''): void {
    const editor = editorRef.current
    if (!editor) return
    const id = createShapeId()
    editor.createShape({ id, type: 'audioNode', x: page.x, y: page.y, props: src ? { src } : {} })
    editor.select(id)
    editor.setCurrentTool('select')
  }

  // 按类型新建节点并返回其 id（供「拖到空白处→添加节点」菜单连线用）
  function createNodeOfKind(kind: 'image' | 'video' | 'audio' | 'videoPrompt', page: Point): string | null {
    const editor = editorRef.current
    if (!editor) return null
    if (kind === 'image') return createGenNode(page)
    if (kind === 'video') createVideoGenNode(page)
    else if (kind === 'audio') createAudioNode(page)
    else createVideoPromptNode(page)
    return (editor.getSelectedShapeIds()[0] as string) || null
  }

  // 从素材库把一个素材插到画布：音频→音频节点；图片→图片节点（名称=素材名，可当参考图连线）
  function insertAsset(a: Asset): void {
    if (a.kind === '音频' || /^data:audio\//i.test(a.src)) {
      createAudioNode(viewportCenter(), a.src)
      try {
        const id = editorRef.current?.getSelectedShapeIds()[0]
        if (id) editorRef.current?.updateShape({ id, type: 'audioNode', props: { name: a.name } })
      } catch {
        /* ignore */
      }
      setShowAssets(false)
      return
    }
    const id = createGenNode(viewportCenter(), a.src)
    if (id) {
      try {
        editorRef.current?.updateShape({ id: id as never, type: 'genNode', props: { title: a.name } })
      } catch {
        /* ignore */
      }
    }
    setShowAssets(false)
  }

  // （旧）批量生成辅助：保留备用
  function createScriptNode(script: string): string | null {
    const editor = editorRef.current
    if (!editor) return null
    const b = editor.getViewportPageBounds()
    const id = createShapeId()
    const text = '📜 剧本\n\n' + (script.length > 380 ? script.slice(0, 380) + '…' : script)
    try {
      editor.createShape({
        id,
        type: 'text',
        x: b.x + 60,
        y: b.y + b.h / 2 - 140,
        props: { richText: toRichText(text), w: 300, autoSize: false }
      })
    } catch {
      return null
    }
    return id as string
  }

  function placeConnectedImage(scriptId: string, prompt: string, src: string, index: number): void {
    const editor = editorRef.current
    if (!editor) return
    const cols = 4
    const size = 230
    const b = editor.getViewportPageBounds()
    const gx = b.x + 480
    const gy = b.y + 70
    const x = gx + (index % cols) * (size + 56)
    const y = gy + Math.floor(index / cols) * (size + 86)
    const id = createShapeId()
    editor.createShape({
      id,
      type: 'genNode',
      x,
      y,
      props: { w: size, h: size, src, prompt, model: imageModel, size: settings.size, status: 'idle', error: '' }
    })
    void loadImageSize(src).then((d) =>
      editor.updateShape({ id, type: 'genNode', props: { h: Math.round((size * d.h) / d.w) } })
    )
    connectNodes(scriptId, id as string)
  }

  function onFile(file: File | undefined): void {
    if (!file || !file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = async () => {
      const src = reader.result as string
      const editor = editorRef.current
      if (!editor) return
      const target = uploadTargetRef.current
      if (target) {
        const d = await loadImageSize(src)
        // 上传图片缩放进 300×300 盒子，避免竖图/大图在画布上过大
        const M = 300
        const w = d.w >= d.h ? M : Math.round((M * d.w) / d.h)
        const h = d.w >= d.h ? Math.round((M * d.h) / d.w) : M
        editor.updateShape({
          id: target as never,
          type: 'genNode',
          props: { src, status: 'idle', w, h }
        })
        editor.select(target as never)
      } else {
        createGenNode(uploadPageRef.current ?? viewportCenter(), src)
      }
      uploadTargetRef.current = null
      uploadPageRef.current = null
    }
    reader.readAsDataURL(file)
  }

  function placeTextOnCanvas(text: string, pos: Point): void {
    const editor = editorRef.current
    if (!editor) return
    try {
      editor.createShape({
        id: createShapeId(),
        type: 'text',
        x: pos.x,
        y: pos.y,
        props: { richText: toRichText(text), w: 380, autoSize: false }
      })
      editor.setCurrentTool('select')
    } catch {
      /* ignore */
    }
  }

  function fitView(): void {
    try {
      editorRef.current?.zoomToFit()
    } catch {
      /* ignore */
    }
  }

  // 整理画布：按连线关系做左→右流式自动排版（无连接的归到第 0 列），再适应视图
  function tidyCanvas(): void {
    const editor = editorRef.current
    if (!editor) return
    const CUSTOM = new Set(['genNode', 'videoGen', 'audioNode', 'videoPrompt', 'scriptNode'])
    const all = editor.getCurrentPageShapes()
    const nodes = all.filter((s) => CUSTOM.has(s.type))
    if (nodes.length < 2) return
    const ids = new Set(nodes.map((s) => s.id as string))
    const out = new Map<string, string[]>()
    const indeg = new Map<string, number>()
    nodes.forEach((s) => {
      out.set(s.id as string, [])
      indeg.set(s.id as string, 0)
    })
    for (const a of all.filter((s) => s.type === 'arrow')) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bs = editor.getBindingsFromShape(a.id, 'arrow') as any[]
      const st = bs.find((b) => b.props?.terminal === 'start')?.toId as string
      const en = bs.find((b) => b.props?.terminal === 'end')?.toId as string
      if (st && en && ids.has(st) && ids.has(en)) {
        out.get(st)!.push(en)
        indeg.set(en, (indeg.get(en) || 0) + 1)
      }
    }
    // 最长路径定列（Kahn 拓扑）
    const depth = new Map<string, number>(nodes.map((s) => [s.id as string, 0]))
    const indeg2 = new Map(indeg)
    const q = nodes.filter((s) => (indeg.get(s.id as string) || 0) === 0).map((s) => s.id as string)
    while (q.length) {
      const id = q.shift()!
      for (const nx of out.get(id) || []) {
        depth.set(nx, Math.max(depth.get(nx) || 0, (depth.get(id) || 0) + 1))
        indeg2.set(nx, (indeg2.get(nx) || 0) - 1)
        if ((indeg2.get(nx) || 0) === 0) q.push(nx)
      }
    }
    const cols = new Map<number, typeof nodes>()
    nodes.forEach((s) => {
      const d = depth.get(s.id as string) || 0
      if (!cols.has(d)) cols.set(d, [])
      cols.get(d)!.push(s)
    })
    const COL_GAP = 130
    const ROW_GAP = 50
    const startX = 0
    const startY = 0
    let x = startX
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updates: any[] = []
    for (const c of [...cols.keys()].sort((a, b) => a - b)) {
      const colShapes = cols.get(c)!.slice().sort((a, b) => a.y - b.y)
      const colW = Math.max(...colShapes.map((s) => editor.getShapePageBounds(s.id)?.w || 300))
      let y = startY
      for (const s of colShapes) {
        const bnds = editor.getShapePageBounds(s.id)
        const w = bnds?.w || 300
        const h = bnds?.h || 300
        updates.push({ id: s.id, type: s.type, x: x + (colW - w) / 2, y })
        y += h + ROW_GAP
      }
      x += colW + COL_GAP
    }
    editor.updateShapes(updates)
    setTimeout(() => editor.zoomToFit({ animation: { duration: 300 } }), 30)
  }

  async function downloadFromSrc(src: string): Promise<void> {
    if (src.startsWith('data:')) {
      const b64 = src.split(',')[1]
      if (b64) await window.api.saveImage({ b64, defaultName: `image-${Date.now()}.png` })
    }
  }

  async function pasteFromClipboard(page: Point): Promise<void> {
    try {
      const items = await navigator.clipboard.read()
      for (const it of items) {
        const type = it.types.find((t) => t.startsWith('image/'))
        if (type) {
          const blob = await it.getType(type)
          const src = await new Promise<string>((res) => {
            const fr = new FileReader()
            fr.onload = () => res(fr.result as string)
            fr.readAsDataURL(blob)
          })
          createGenNode(page, src)
          return
        }
      }
    } catch {
      /* 剪贴板不可用 */
    }
  }

  function openPanelCenter(type: GenType): void {
    setPanel({
      type,
      x: Math.max(12, window.innerWidth / 2 - 170),
      y: Math.max(12, window.innerHeight / 2 - 160),
      page: viewportCenter()
    })
  }

  // ===== 项目管理 =====
  function persistProjects(next: Project[]): void {
    setProjects(next)
    saveProjects(next)
  }
  function openProject(id: string): void {
    setProjectId(id)
    setView('canvas')
  }
  function createProject(kind: ProjectKind = 'canvas'): void {
    const p: Project = {
      id: newId(),
      name: kind === 'reroll' ? '未命名转绘' : '未命名项目',
      kind,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    persistProjects([p, ...projects])
    openProject(p.id)
  }
  function deleteProject(id: string): void {
    persistProjects(projects.filter((p) => p.id !== id))
  }
  function renameProject(id: string, name: string): void {
    persistProjects(projects.map((p) => (p.id === id ? { ...p, name, updatedAt: Date.now() } : p)))
  }
  function goHome(): void {
    persistProjects(projects.map((p) => (p.id === projectId ? { ...p, updatedAt: Date.now() } : p)))
    setView('home')
  }

  // 用绑定箭头连接两个节点（fromId 输出 → toId 输入）
  function connectNodes(fromId: string, toId: string): void {
    const editor = editorRef.current
    if (!editor || fromId === toId) return
    try {
      const arrowId = createShapeId()
      editor.createShape({ id: arrowId, type: 'arrow', isLocked: true, props: { color: 'white' } })
      editor.createBindings([
        {
          id: createBindingId(),
          type: 'arrow',
          fromId: arrowId as never,
          toId: fromId as never,
          props: { terminal: 'start', normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false }
        },
        {
          id: createBindingId(),
          type: 'arrow',
          fromId: arrowId as never,
          toId: toId as never,
          props: { terminal: 'end', normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false }
        }
      ])
    } catch {
      /* ignore */
    }
  }

  // 端点 / 模型管理
  function updEp(cap: 'image' | 'video' | 'voice', patch: Partial<Endpoint>): void {
    update({ [cap]: { ...settings[cap], ...patch } } as Partial<Settings>)
  }
  // 打开设置；默认进「API 设置」一级菜单（四项），传 tab 才直达具体页
  function openSettings(
    tab: 'image' | 'video' | 'voice' | 'reverse' | 'assetgen' | null = null
  ): void {
    setSettingsTab(tab)
    setShowSettings(true)
  }
  function addChat(name: string): void {
    const n = name.trim()
    if (!n || settings.chatModels.includes(n)) return
    update({ chatModels: [...settings.chatModels, n] })
  }
  function removeChat(name: string): void {
    update({ chatModels: settings.chatModels.filter((m) => m !== name) })
  }

  function openPanel(type: GenType, m: { x: number; y: number; page: Point }): void {
    const W = 340
    const H = 290
    const x = Math.max(12, Math.min(m.x, window.innerWidth - W - 12))
    const y = Math.max(12, Math.min(m.y, window.innerHeight - H - 12))
    setPanel({ type, x, y, page: m.page })
    setMenu(null)
  }

  async function runTextGen(page: Point, opts: { prompt: string; model: string }): Promise<void> {
    // 对话/文本复用图片端点的地址 + 密钥
    if (!imgEp.apiKey) throw new Error('请先在设置 → 图片生成里填入 API 密钥')
    const text = await window.api.textGenerate({
      baseURL: imgEp.baseURL,
      apiKey: imgEp.apiKey,
      model: opts.model,
      prompt: opts.prompt
    })
    placeTextOnCanvas(text, page)
  }

  async function placeVideoOnCanvas(url: string, page: Point): Promise<void> {
    const editor = editorRef.current
    if (!editor) return
    const dim = await loadVideoSize(url)
    const assetId = AssetRecordType.createId()
    editor.createAssets([
      {
        id: assetId,
        typeName: 'asset',
        type: 'video',
        meta: {},
        props: { name: 'video.mp4', src: url, w: dim.w, h: dim.h, mimeType: 'video/mp4', isAnimated: true }
      }
    ])
    const maxSide = 460
    const scale = Math.min(1, maxSide / Math.max(dim.w, dim.h))
    editor.createShape({
      id: createShapeId(),
      type: 'video',
      x: page.x,
      y: page.y,
      props: { assetId, w: dim.w * scale, h: dim.h * scale }
    })
    editor.setCurrentTool('select')
  }

  async function runVideoGen(page: Point, opts: { prompt: string; model: string }): Promise<void> {
    if (!vidEp.apiKey) throw new Error('请先在设置 → 视频生成里填入 API 密钥')
    let url: string
    if (vidEp.api === 'task521' || /521xxz\.com/i.test(vidEp.baseURL)) {
      const r = await window.api.task521Video({
        baseURL: vidEp.baseURL,
        apiKey: vidEp.apiKey,
        model: opts.model,
        prompt: opts.prompt,
        seconds: /grok/i.test(opts.model) ? 15 : 5,
        aspectRatio: '16:9',
        resolution: '720p'
      })
      url = r.url
    } else {
      const r = await window.api.videoGenerate({
        baseURL: vidEp.baseURL,
        apiKey: vidEp.apiKey,
        model: opts.model,
        prompt: opts.prompt
      })
      url = r.url
    }
    await placeVideoOnCanvas(url, page)
  }

  const ctxValue = {
    baseURL: imgEp.baseURL,
    apiKey: imgEp.apiKey,
    imageModels,
    textModels,
    defaultModel: imageModel,
    defaultSize: settings.size,
    apiType: imgEp.api,
    videoBaseURL: vidEp.baseURL,
    videoApiKey: vidEp.apiKey,
    videoApiType: vidEp.api,
    videoModels: vidEp.models,
    videoModel,
    templates: settings.templates,
    revBaseURL: settings.reverse.baseURL,
    revApiKey: settings.reverse.apiKey,
    revModel: settings.reverse.model,
    revFps: settings.reverse.fps,
    styles: settings.styles,
    assetTypes: settings.assetTypes,
    openSettings: (tab?: string) =>
      openSettings((tab as 'image' | 'video' | 'voice' | 'reverse' | 'assetgen') || 'image'),
    openTemplates: () => setShowTemplates(true),
    requestUpload: (nodeId: string) => {
      uploadTargetRef.current = nodeId
      uploadPageRef.current = null
      fileRef.current?.click()
    },
    pickAssets: (onPick: (srcs: string[]) => void) => {
      assetPickCbRef.current = onPick
      setAssetPickMode(true)
      setShowAssets(true)
    },
    startConnect: (fromId: string, sx: number, sy: number, dir: 'in' | 'out') =>
      setConnectDrag({ fromId, sx, sy, x: sx, y: sy, dir }),
    openLightbox: (src: string) => setLightbox({ src }),
    openCrop: (src: string, onApply: (s: string) => void) => setImgEdit({ mode: 'crop', src, onApply }),
    openAnnotate: (src: string, onApply: (s: string) => void) => setImgEdit({ mode: 'annotate', src, onApply })
  }

  // 设置弹窗：二级菜单（一级=能力列表，点进二级=该能力详情）。首页 + 画布两处都可弹
  const SETTINGS_TABS = [
    { id: 'image' as const, icon: '🖼', title: '图片生成', sub: `${imgEp.name || '未配置'} · ${imageModel || '未选模型'}` },
    { id: 'video' as const, icon: '🎬', title: '视频生成', sub: `${vidEp.name || '未配置'} · ${videoModel || '未选模型'}` },
    {
      id: 'voice' as const,
      icon: '🗣',
      title: '大语音模型（配音 / TTS）',
      sub: settings.voice.apiKey ? `${settings.voice.name || '已配置'} · ${settings.voice.model || '未选模型'}` : '未配置'
    },
    {
      id: 'reverse' as const,
      icon: '🎞',
      title: '转绘 · 视频反推',
      sub: settings.reverse.apiKey ? `${hostName(settings.reverse.baseURL)} · ${settings.reverse.model}` : '未配置'
    },
    {
      id: 'assetgen' as const,
      icon: '🎨',
      title: '资产生成配置',
      sub: `${settings.styles.length} 风格 · ${settings.assetTypes.length} 资产类型`
    }
  ]
  const currentTab = SETTINGS_TABS.find((t) => t.id === settingsTab)
  const settingsModal = showSettings && (
    <div className="modal-backdrop" onClick={() => setShowSettings(false)}>
      <div className="modal modal-settings" onClick={(e) => e.stopPropagation()}>
        {settingsTab === null ? (
          <>
            <h2>API 设置</h2>
            <p className="settings-tip">点进每项单独配置渠道 / 密钥 / 模型，互不影响（可混用不同网站）。提示词模板在首页「🎨 提示词模板」里。</p>
            {SETTINGS_TABS.map((t) => (
              <button key={t.id} className="settings-nav" onClick={() => setSettingsTab(t.id)}>
                <span className="settings-nav-ico">{t.icon}</span>
                <span className="settings-nav-txt">
                  <span className="settings-nav-title">{t.title}</span>
                  <span className="settings-nav-sub">{t.sub}</span>
                </span>
                <span className="settings-nav-arrow">›</span>
              </button>
            ))}
            <button className="primary wide" onClick={() => setShowSettings(false)}>
              完成
            </button>
          </>
        ) : (
          <>
            <div className="settings-detail-head">
              <button className="settings-back" onClick={() => setSettingsTab(null)}>
                ‹ 返回
              </button>
              <h2>
                {currentTab?.icon} {currentTab?.title}
              </h2>
            </div>

            {settingsTab === 'image' && (
              <>
                <EndpointSection ep={settings.image} onChange={(p) => updEp('image', p)} />
                {settings.chatModels.length > 0 && (
                  <label className="field">
                    <span>对话模型（剧本提取用）</span>
                    <select value={settings.chatModel} onChange={(e) => update({ chatModel: e.target.value })}>
                      {settings.chatModels.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </>
            )}

            {settingsTab === 'video' && (
              <VideoSettings
                video={settings.video}
                videoKeys={settings.videoKeys}
                onChange={(videoPatch, keysPatch) =>
                  update({
                    video: { ...settings.video, ...videoPatch },
                    ...(keysPatch ? { videoKeys: keysPatch } : {})
                  })
                }
              />
            )}

            {settingsTab === 'voice' && (
              <EndpointSection ep={settings.voice} onChange={(p) => updEp('voice', p)} namePlaceholder="如 火山 / minimax" />
            )}

            {settingsTab === 'reverse' && (
              <>
                <label className="field">
                  <span>接口地址</span>
                  <input
                    value={settings.reverse.baseURL}
                    onChange={(e) => update({ reverse: { ...settings.reverse, baseURL: e.target.value } })}
                    placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1"
                  />
                </label>
                <label className="field">
                  <span>API 密钥</span>
                  <KeyInput
                    value={settings.reverse.apiKey}
                    onChange={(v) => update({ reverse: { ...settings.reverse, apiKey: v } })}
                    placeholder="sk-…（阿里云百炼 / DashScope 的 key）"
                  />
                </label>
                <div className="settings-row2">
                  <label className="field">
                    <span>反推模型</span>
                    <input
                      value={settings.reverse.model}
                      onChange={(e) => update({ reverse: { ...settings.reverse, model: e.target.value } })}
                      placeholder="qwen-vl-max"
                    />
                  </label>
                  <label className="field">
                    <span>抽帧 fps</span>
                    <input
                      type="number"
                      min={0.5}
                      max={8}
                      step={0.5}
                      value={settings.reverse.fps}
                      onChange={(e) => update({ reverse: { ...settings.reverse, fps: Number(e.target.value) || 2 } })}
                    />
                  </label>
                </div>
              </>
            )}

            {settingsTab === 'assetgen' && (
              <AssetGenSettings
                styles={settings.styles}
                assetTypes={settings.assetTypes}
                onChange={(patch) => update(patch)}
              />
            )}

            <button className="primary wide" onClick={() => setShowSettings(false)}>
              完成
            </button>
          </>
        )}
      </div>
    </div>
  )

  // 提示词模板编辑器（字字动画式大窗），首页 + 画布两处都可弹
  const templateModal = showTemplates && (
    <TemplateManager
      templates={settings.templates}
      textModels={textModels}
      onChange={(tpls) => update({ templates: tpls })}
      onClose={() => setShowTemplates(false)}
    />
  )

  // 素材库三种打开方式：首页=纯管理；画布 📦=点素材插入画布；节点「素材库」按钮=多选拾取回传
  const closeAssets = (): void => {
    setShowAssets(false)
    setAssetPickMode(false)
    assetPickCbRef.current = null
  }
  const assetsModal = showAssets && (
    <AssetLibrary
      onClose={closeAssets}
      onInsert={!assetPickMode && view === 'canvas' ? insertAsset : undefined}
      onPick={
        assetPickMode
          ? (srcs) => {
              assetPickCbRef.current?.(srcs)
              closeAssets()
            }
          : undefined
      }
    />
  )

  const usageModal = showUsage && <UsageLog onClose={() => setShowUsage(false)} />
  const imgEditModal =
    imgEdit &&
    (imgEdit.mode === 'crop' ? (
      <CropModal src={imgEdit.src} onApply={imgEdit.onApply} onClose={() => setImgEdit(null)} />
    ) : (
      <AnnotateModal src={imgEdit.src} onApply={imgEdit.onApply} onClose={() => setImgEdit(null)} />
    ))

  const currentProject = projects.find((p) => p.id === projectId)
  if (view === 'home') {
    return (
      <>
        <HomePage
          projects={projects}
          onOpen={openProject}
          onCreate={createProject}
          onDelete={deleteProject}
          onOpenSettings={() => openSettings()}
          onOpenTemplates={() => setShowTemplates(true)}
          onOpenAssets={() => setShowAssets(true)}
          onOpenUsage={() => setShowUsage(true)}
        />
        {settingsModal}
        {templateModal}
        {assetsModal}
        {usageModal}
        {imgEditModal}
      </>
    )
  }

  return (
    <div className="app">
      <div className="canvas" onPointerDown={() => setSelectedConn(null)}>
        <GenContext.Provider value={ctxValue}>
          <Tldraw
            key={projectId}
            persistenceKey={persistKey(projectId)}
            shapeUtils={SHAPE_UTILS}
            components={TLDRAW_COMPONENTS}
            onMount={(editor) => {
              editorRef.current = editor
              setEditor(editor)
              ;(window as unknown as { __editor?: Editor }).__editor = editor
              try {
                editor.user.updateUserPreferences({ colorScheme: 'dark' })
                editor.updateInstanceState({ isGridMode: true })
              } catch {
                /* ignore */
              }
              // 接管文件拖入：建成我们的图片节点（无 10MB 限制，尺寸按视口）
              try {
                editor.registerExternalContentHandler(
                  'files',
                  async (info: { files: File[]; point?: { x: number; y: number } }) => {
                    const c = info.point || editor.getViewportPageBounds().center
                    let i = 0
                    for (const file of info.files) {
                      if (!file.type.startsWith('image/')) continue
                      const src = await new Promise<string>((res) => {
                        const fr = new FileReader()
                        fr.onload = () => res(fr.result as string)
                        fr.readAsDataURL(file)
                      })
                      createGenNode({ x: c.x - 110 + i * 40, y: c.y - 110 + i * 40 }, src)
                      i++
                    }
                  }
                )
              } catch {
                /* ignore */
              }
              // 本应用只用「选择」工具：任何切到箭头/画线/几何等工具立即切回，
              // 避免误按快捷键（如 a=箭头）后鼠标拖出蓝色箭头
              try {
                react('force-select-tool', () => {
                  const t = editor.getCurrentToolId()
                  // 允许导航工具（选择/抓手/缩放），拦截一切会画形状的工具（箭头/画笔/几何等）
                  if (t !== 'select' && t !== 'hand' && t !== 'zoom') editor.setCurrentTool('select')
                })
              } catch {
                /* ignore */
              }
              // 任何新建的箭头（连线载体或误触画出的）一律锁定，杜绝被框选出现蓝线
              try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ;(editor as any).sideEffects.registerAfterCreateHandler('shape', (shape: any) => {
                  if (shape.type === 'arrow' && !shape.isLocked) {
                    editor.updateShape({ id: shape.id, type: 'arrow', isLocked: true } as never)
                  }
                })
              } catch {
                /* ignore */
              }
              // 连线箭头只作数据载体：某端节点被删 → 绑定被删 → 箭头只剩单端 → 删除，
              // 避免残留出现可框选的蓝色断线
              try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ;(editor as any).sideEffects.registerAfterDeleteHandler('binding', (binding: any) => {
                  if (binding.type !== 'arrow') return
                  const arrowId = binding.fromId
                  const arrow = editor.getShape(arrowId)
                  if (!arrow || arrow.type !== 'arrow') return
                  if (editor.getBindingsFromShape(arrowId, 'arrow').length < 2) {
                    editor.updateShape({ id: arrowId, type: 'arrow', isLocked: false } as never)
                    editor.deleteShapes([arrowId])
                  }
                })
              } catch {
                /* ignore */
              }
              // 画布打开默认 100% + 居中到内容；并锁定连线箭头 / 清理断头连线
              setTimeout(() => {
                try {
                  editor.setCamera({ x: 0, y: 0, z: 1 })
                  const b = editor.getCurrentPageBounds()
                  if (b) editor.centerOnPoint(b.center)
                } catch {
                  /* ignore */
                }
                try {
                  for (const s of editor.getCurrentPageShapes()) {
                    if (s.type !== 'arrow') continue
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const bs = editor.getBindingsFromShape(s.id, 'arrow') as any[]
                    const ok =
                      bs.some((b) => b.props?.terminal === 'start' && editor.getShape(b.toId)) &&
                      bs.some((b) => b.props?.terminal === 'end' && editor.getShape(b.toId))
                    if (!ok) {
                      editor.updateShape({ id: s.id, type: 'arrow', isLocked: false } as never)
                      editor.deleteShapes([s.id])
                    } else if (!s.isLocked) {
                      editor.updateShape({ id: s.id, type: 'arrow', isLocked: true } as never)
                    }
                  }
                } catch {
                  /* ignore */
                }
              }, 60)
            }}
          />
        </GenContext.Provider>
      </div>

      <div className="topbar">
        <button className="brand brand-btn" onClick={goHome} title="返回工作空间">
          <span className="dot" />
          <span className="back-arrow">‹ 工作空间</span>
        </button>
        <input
          className="proj-name"
          value={currentProject?.name ?? ''}
          placeholder="未命名项目"
          onChange={(e) => renameProject(projectId, e.target.value)}
        />
        <span className="autosave">● 已保存</span>
        <button className="statuschip" onClick={() => openSettings()} title="API 设置（渠道 / 密钥 / 模型）">
          ⚙ API 设置
        </button>
        <button className="statuschip" onClick={() => setShowUsage(true)} title="使用日志（模型 / 提交 / 生成 / 用时）">
          📊 日志
        </button>
        <button className="statuschip" onClick={tidyCanvas} title="整理画布（按连线自动排版）">
          🧹 整理画布
        </button>
        <span className="hint">右键画布 = 生成菜单</span>
      </div>

      <div className="rail">
        <button className="rail-btn rail-add" onClick={() => setShowAdd((v) => !v)} title="添加节点">
          ＋
        </button>
        <button
          className="rail-btn"
          onClick={() => {
            uploadTargetRef.current = null
            uploadPageRef.current = null
            fileRef.current?.click()
          }}
          title="上传图片"
        >
          ⬆
        </button>
        <button className="rail-btn" onClick={fitView} title="适应视图">
          ⊡
        </button>
        <button className="rail-btn" onClick={() => setShowAssets(true)} title="素材库（点素材插入画布）">
          📦
        </button>
        <button className="rail-btn" onClick={() => openSettings()} title="API 设置（渠道 / 密钥 / 模型）">
          ⚙
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            onFile(e.target.files?.[0])
            e.target.value = ''
          }}
        />
      </div>

      {showAdd && (
        <>
          <div className="menu-backdrop" onClick={() => setShowAdd(false)} />
          <div className="addflyout">
            <div className="cm-sec">添加节点</div>
            <button
              className="cm-item"
              onClick={() => {
                createGenNode(viewportCenter())
                setShowAdd(false)
              }}
            >
              <span className="cm-ico">🖼</span>
              <span className="cm-txt">
                <span className="cm-name">图片</span>
                <span className="cm-sub">文生图 / 图生图 / 多图融合</span>
              </span>
            </button>
            <button
              className="cm-item"
              onClick={() => {
                openPanelCenter('text')
                setShowAdd(false)
              }}
            >
              <span className="cm-ico">📝</span>
              <span className="cm-txt">
                <span className="cm-name">文本</span>
                <span className="cm-sub">脚本、文案、提示词</span>
              </span>
            </button>
            <button
              className="cm-item"
              onClick={() => {
                createVideoGenNode(viewportCenter())
                setShowAdd(false)
              }}
            >
              <span className="cm-ico">🎬</span>
              <span className="cm-txt">
                <span className="cm-name">视频</span>
                <span className="cm-sub">文生视频</span>
              </span>
            </button>
            <button
              className="cm-item"
              onClick={() => {
                createAudioNode(viewportCenter())
                setShowAdd(false)
              }}
            >
              <span className="cm-ico">🎵</span>
              <span className="cm-txt">
                <span className="cm-name">音频</span>
                <span className="cm-sub">上传音频 → 连到视频节点当参考音频</span>
              </span>
            </button>
            <div className="sep" />
            <div className="cm-sec">转绘工作流</div>
            <button
              className="cm-item"
              onClick={() => {
                createVideoPromptNode(viewportCenter())
                setShowAdd(false)
              }}
            >
              <span className="cm-ico">🎞️</span>
              <span className="cm-txt">
                <span className="cm-name">视频反推</span>
                <span className="cm-sub">上传视频 → 抽帧 → 反推提示词</span>
              </span>
            </button>
            <button
              className="cm-item"
              onClick={() => {
                createGenNode(viewportCenter())
                setShowAdd(false)
              }}
            >
              <span className="cm-ico">🖼</span>
              <span className="cm-txt">
                <span className="cm-name">图片生成</span>
                <span className="cm-sub">转绘出图（文生图 / 参考图）</span>
              </span>
            </button>
            <button
              className="cm-item"
              onClick={() => {
                createVideoGenNode(viewportCenter())
                setShowAdd(false)
              }}
            >
              <span className="cm-ico">🎬</span>
              <span className="cm-txt">
                <span className="cm-name">视频生成</span>
                <span className="cm-sub">提示词 → 视频</span>
              </span>
            </button>
            <div className="sep" />
            <div className="cm-sec">添加资源</div>
            <button
              className="cm-item"
              onClick={() => {
                uploadTargetRef.current = null
                uploadPageRef.current = null
                setShowAdd(false)
                fileRef.current?.click()
              }}
            >
              <span className="cm-ico">⬆</span>
              <span className="cm-name">上传图片</span>
            </button>
            <button
              className="cm-item"
              onClick={() => {
                setShowAdd(false)
                createScriptNodeShape(viewportCenter())
              }}
            >
              <span className="cm-ico">⚡</span>
              <span className="cm-txt">
                <span className="cm-name">剧本批量生成</span>
                <span className="cm-sub">剧本 → 人物 → 批量出图</span>
              </span>
            </button>
          </div>
        </>
      )}

      {editor && (
        <ConnectionsLayer editor={editor} selectedConn={selectedConn} onSelect={setSelectedConn} />
      )}

      {selectedConn && <div className="connect-hint">连线已选中 · 按 Delete 删除</div>}

      {connectDrag && (
        <svg className="connect-layer">
          <line
            x1={connectDrag.sx}
            y1={connectDrag.sy}
            x2={connectDrag.x}
            y2={connectDrag.y}
            stroke="var(--accent)"
            strokeWidth={2.5}
            strokeDasharray="6 4"
          />
        </svg>
      )}

      {error && <div className="toast">{error}</div>}

      {menu && (
        <>
          <div className="menu-backdrop" onClick={() => setMenu(null)} />
          <div className="ctxmenu" style={{ left: menu.x, top: menu.y }}>
            <div className="cm-sec">添加节点</div>
            <button
              className="cm-item"
              onClick={() => {
                createGenNode(menu.page)
                setMenu(null)
              }}
            >
              <span className="cm-ico">🖼</span>
              <span className="cm-txt">
                <span className="cm-name">图片</span>
                <span className="cm-sub">文生图 / 图生图 / 多图融合</span>
              </span>
            </button>
            <button className="cm-item" onClick={() => openPanel('text', menu)}>
              <span className="cm-ico">📝</span>
              <span className="cm-txt">
                <span className="cm-name">文本</span>
                <span className="cm-sub">脚本、文案、提示词</span>
              </span>
            </button>
            <button
              className="cm-item"
              onClick={() => {
                createVideoGenNode(menu.page)
                setMenu(null)
              }}
            >
              <span className="cm-ico">🎬</span>
              <span className="cm-txt">
                <span className="cm-name">视频</span>
                <span className="cm-sub">文生视频（节点）</span>
              </span>
            </button>
            <button
              className="cm-item"
              onClick={() => {
                createAudioNode(menu.page)
                setMenu(null)
              }}
            >
              <span className="cm-ico">🎵</span>
              <span className="cm-txt">
                <span className="cm-name">上传音频</span>
                <span className="cm-sub">音频节点 → 连到视频节点当参考音频</span>
              </span>
            </button>
            <button
              className="cm-item"
              onClick={() => {
                createVideoPromptNode(menu.page)
                setMenu(null)
              }}
            >
              <span className="cm-ico">🎞️</span>
              <span className="cm-txt">
                <span className="cm-name">视频反推（转绘）</span>
                <span className="cm-sub">上传视频 → 抽帧 → 反推分镜提示词</span>
              </span>
            </button>
            <div className="sep" />
            <button
              className="cm-item"
              onClick={() => {
                uploadTargetRef.current = null
                uploadPageRef.current = menu.page
                setMenu(null)
                fileRef.current?.click()
              }}
            >
              <span className="cm-ico">⬆</span>
              <span className="cm-name">上传图片</span>
            </button>
            <button
              className="cm-item"
              onClick={() => {
                createScriptNodeShape(menu.page)
                setMenu(null)
              }}
            >
              <span className="cm-ico">⚡</span>
              <span className="cm-txt">
                <span className="cm-name">剧本批量生成</span>
                <span className="cm-sub">剧本 → 人物提示词 → 批量出图</span>
              </span>
            </button>
            <div className="sep" />
            <button
              className="cm-item"
              onClick={() => {
                editorRef.current?.undo()
                setMenu(null)
              }}
            >
              <span className="cm-ico">↩</span>
              <span className="cm-name">撤销</span>
              <span className="cm-sc">Ctrl Z</span>
            </button>
            <button
              className="cm-item"
              onClick={() => {
                editorRef.current?.redo()
                setMenu(null)
              }}
            >
              <span className="cm-ico">↪</span>
              <span className="cm-name">重做</span>
              <span className="cm-sc">⇧Ctrl Z</span>
            </button>
            <button
              className="cm-item"
              onClick={() => {
                void pasteFromClipboard(menu.page)
                setMenu(null)
              }}
            >
              <span className="cm-ico">📋</span>
              <span className="cm-name">粘贴</span>
              <span className="cm-sc">Ctrl V</span>
            </button>
          </div>
        </>
      )}

      {panel && (
        <GeneratorPanel
          key={`${panel.type}-${panel.x}-${panel.y}`}
          type={panel.type}
          x={panel.x}
          y={panel.y}
          page={panel.page}
          textModels={textModels}
          videoModels={videoModels}
          onClose={() => setPanel(null)}
          runText={runTextGen}
          runVideo={runVideoGen}
        />
      )}

      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(null)}>
          <img src={lightbox.src} alt="" onClick={(e) => e.stopPropagation()} />
          <div className="lb-tools" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => downloadFromSrc(lightbox.src)}>⬇ 下载</button>
            <button onClick={() => setLightbox(null)}>✕ 关闭</button>
          </div>
        </div>
      )}

      {connectMenu && (
        <>
          <div className="cm-mask" onPointerDown={() => setConnectMenu(null)} />
          <div
            className="connect-menu"
            style={{ left: Math.min(connectMenu.x, window.innerWidth - 296), top: Math.min(connectMenu.y, window.innerHeight - 260) }}
          >
            <div className="cm-title">引用该节点生成</div>
            {CONNECT_NODE_OPTIONS.map((o) => (
              <button
                key={o.k}
                className="cm-item"
                onClick={() => {
                  const nid = createNodeOfKind(o.k, connectMenu.page)
                  if (nid) {
                    if (connectMenu.dir === 'in') connectNodes(nid, connectMenu.fromId)
                    else connectNodes(connectMenu.fromId, nid)
                  }
                  setConnectMenu(null)
                }}
              >
                <span className="cm-ic">{o.icon}</span>
                <span className="cm-text">
                  <span className="cm-name">{o.title}</span>
                  <span className="cm-sub">{o.sub}</span>
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      {settingsModal}
      {templateModal}
      {assetsModal}
      {usageModal}
      {imgEditModal}
    </div>
  )
}

// ===== 连线叠加层：读箭头绑定，按节点位置实时画曲线（跟随缩放/移动） =====
const ConnectionsLayer = track(function ConnectionsLayer({
  editor,
  selectedConn,
  onSelect
}: {
  editor: Editor
  selectedConn: string | null
  onSelect: (id: string | null) => void
}): JSX.Element {
  editor.getCamera() // 订阅相机变化
  const shapes = editor.getCurrentPageShapes()
  const paths: { id: string; d: string; mx: number; my: number }[] = []
  for (const a of shapes) {
    if (a.type !== 'arrow') continue
    const bs = editor.getBindingsFromShape(a.id, 'arrow') as Array<{
      toId: string
      props?: { terminal?: string }
    }>
    const startB = bs.find((b) => b.props?.terminal === 'start')
    const endB = bs.find((b) => b.props?.terminal === 'end')
    if (!startB || !endB) continue
    const sb = editor.getShapePageBounds(startB.toId as never)
    const eb = editor.getShapePageBounds(endB.toId as never)
    if (!sb || !eb) continue
    const p1 = editor.pageToViewport({ x: sb.maxX, y: sb.y + sb.h / 2 })
    const p2 = editor.pageToViewport({ x: eb.minX, y: eb.y + eb.h / 2 })
    const dx = Math.max(40, Math.abs(p2.x - p1.x) * 0.5)
    paths.push({
      id: a.id,
      d: `M ${p1.x} ${p1.y} C ${p1.x + dx} ${p1.y}, ${p2.x - dx} ${p2.y}, ${p2.x} ${p2.y}`,
      mx: (p1.x + p2.x) / 2,
      my: (p1.y + p2.y) / 2
    })
  }
  const delConn = (id: string): void => {
    try {
      editor.updateShape({ id: id as never, type: 'arrow', isLocked: false } as never)
    } catch {
      /* ignore */
    }
    editor.deleteShapes([id as never])
    onSelect(null)
  }
  return (
    <svg className="connect-layer">
      {paths.map((p) => (
        <g key={p.id}>
          <path
            d={p.d}
            stroke="transparent"
            strokeWidth={24}
            fill="none"
            style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
            onPointerDown={(e) => {
              e.stopPropagation()
              editor.selectNone()
              onSelect(p.id)
            }}
          />
          <path
            d={p.d}
            stroke={selectedConn === p.id ? '#ff6b6b' : 'var(--accent)'}
            strokeWidth={selectedConn === p.id ? 4 : 2.5}
            fill="none"
            opacity={0.95}
            style={{ pointerEvents: 'none' }}
          />
          {/* 连线中点的 × 删除按钮 */}
          <g
            className="conn-del"
            transform={`translate(${p.mx}, ${p.my})`}
            style={{ pointerEvents: 'all', cursor: 'pointer' }}
            onPointerDown={(e) => {
              e.stopPropagation()
              delConn(p.id)
            }}
          >
            <circle r={10} />
            <line x1={-3.5} y1={-3.5} x2={3.5} y2={3.5} />
            <line x1={3.5} y1={-3.5} x2={-3.5} y2={3.5} />
          </g>
        </g>
      ))}
    </svg>
  )
})

// ===== 文本 / 视频 生成窗口（右键菜单弹出） =====
function GeneratorPanel(props: {
  type: GenType
  x: number
  y: number
  page: Point
  textModels: string[]
  videoModels: string[]
  onClose: () => void
  runText: (page: Point, opts: { prompt: string; model: string }) => Promise<void>
  runVideo: (page: Point, opts: { prompt: string; model: string }) => Promise<void>
}): JSX.Element {
  const isVideo = props.type === 'video'
  const list = isVideo ? props.videoModels : props.textModels
  const [prompt, setPrompt] = useState('')
  const [model, setModel] = useState(() =>
    isVideo && list.includes('grok-video-1.5-pro') ? 'grok-video-1.5-pro' : list[0] || ''
  )
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [progress, setProgress] = useState(0)

  const title = isVideo ? '🎬 生成视频' : '📝 生成文本'
  const modelOptions = model && !list.includes(model) ? [model, ...list] : list

  async function go(): Promise<void> {
    if (!prompt.trim()) {
      setErr('请输入提示词')
      return
    }
    setBusy(true)
    setErr('')
    let off: (() => void) | undefined
    if (isVideo) {
      setProgress(0)
      off = window.api.onVideoProgress((p) => setProgress(p))
    }
    try {
      if (isVideo) await props.runVideo(props.page, { prompt, model })
      else await props.runText(props.page, { prompt, model })
      props.onClose()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
      if (off) off()
    }
  }

  return (
    <div className="genpanel" style={{ left: props.x, top: props.y }}>
      <div className="gp-head">
        <span className="gp-htitle">
          <span className="cm-ico">{isVideo ? '🎬' : '📝'}</span>
          {isVideo ? '生成视频' : '生成文本'}
        </span>
        <button className="gp-x" onClick={props.onClose}>
          ×
        </button>
      </div>

      {isVideo && <div className="gp-note">视频约需 1–2 分钟，生成期间请保持此窗口打开。</div>}

      <textarea
        className="gp-prompt"
        autoFocus
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder={isVideo ? '描述你想生成的视频…（回车）' : '想生成什么文案 / 内容…（回车）'}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            if (!busy) void go()
          }
        }}
      />

      <div className="gp-row">
        <ModelPicker value={model} models={modelOptions} onChange={setModel} />
      </div>

      {err && <div className="gp-err">{err}</div>}

      {busy && isVideo && (
        <div className="gp-progress">
          <div className="gp-bar" style={{ width: `${Math.max(4, progress)}%` }} />
        </div>
      )}

      <button className="primary wide" onClick={go} disabled={busy}>
        {busy ? (isVideo ? `生成中… ${progress}%` : '生成中…') : isVideo ? '生成视频' : '生成'}
      </button>
    </div>
  )
}
