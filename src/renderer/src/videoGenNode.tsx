import { useState, useContext, useRef, useEffect, type ChangeEvent } from 'react'
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
import { GenContext, prettifyModel } from './genNode'
import { MentionInput } from './MentionInput'
import { ResizeHandle } from './nodeResize'
import { recordUsage } from './usageLog'

// 已自动开跑的结果视频节点 id（避免重渲染/重挂载时重复提交）
const STARTED_VIDEOS = new Set<string>()

export type VideoGenShape = TLBaseShape<
  'videoGen',
  {
    w: number
    h: number
    src: string
    prompt: string
    model: string
    ratio: string
    resolution: string
    seconds: number
    refs: string // 参考图（JSON：{url, role}[]，role=reference_image/first_frame/last_frame；兼容老的纯字符串数组）
    audios: string // 参考音频（JSON 字符串数组，最多 3）
    videos: string // 参考视频（JSON 字符串数组，最多 3）
    audio: boolean // 生成音频
    status: string // idle | loading | error
    error: string
  }
>

type RefRole = 'reference_image' | 'first_frame' | 'last_frame'
interface VRef {
  url: string
  role: RefRole
}

// 角色：循环切换 + 中文短标/全名
const ROLE_ORDER: RefRole[] = ['reference_image', 'first_frame', 'last_frame']
const ROLE_SHORT: Record<RefRole, string> = { reference_image: '参', first_frame: '首', last_frame: '尾' }
const ROLE_NAME: Record<RefRole, string> = { reference_image: '参考图', first_frame: '首帧', last_frame: '尾帧' }

// 解析 refs：兼容老的 string[] 与新的 {url,role}[]
function parseVRefs(s: string): VRef[] {
  try {
    const a = JSON.parse(s || '[]')
    if (!Array.isArray(a)) return []
    return a
      .map((x): VRef | null => {
        if (typeof x === 'string') return x ? { url: x, role: 'reference_image' } : null
        if (x && typeof x.url === 'string')
          return { url: x.url, role: ROLE_ORDER.includes(x.role) ? x.role : 'reference_image' }
        return null
      })
      .filter((x): x is VRef => !!x)
  } catch {
    return []
  }
}

// 参考音频 / 视频：JSON 字符串数组
function parseAudios(s: string): string[] {
  try {
    const a = JSON.parse(s || '[]')
    return Array.isArray(a) ? a.filter((x) => typeof x === 'string' && x) : []
  } catch {
    return []
  }
}

const VW = 380

const RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4']
const RESOLUTIONS = ['720p', '480p'] // seedance2(521ai-SD) 仅支持 720p/480p
const DURATIONS = [4, 5, 6, 8, 10, 12, 15]

function loadVideoDim(url: string): Promise<{ w: number; h: number }> {
  return new Promise((res) => {
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.onloadedmetadata = () => res({ w: v.videoWidth || 1280, h: v.videoHeight || 720 })
    v.onerror = () => res({ w: 1280, h: 720 })
    v.src = url
  })
}

const VideoBody = track(function VideoBody({ shape }: { shape: VideoGenShape }) {
  const editor = useEditor()
  const ctx = useContext(GenContext)
  const p = shape.props
  const selected = editor.getSelectedShapeIds().includes(shape.id)
  // 生成器 = 空白编辑框（无 src 且 idle）；其余（loading/error/有视频）= 结果节点
  const isGenerator = p.status === 'idle' && !p.src

  const [prompt, setPrompt] = useState(p.prompt)
  const [model, setModel] = useState(p.model || ctx.videoModel)
  const [ratio, setRatio] = useState(p.ratio || '16:9')
  const [resolution, setResolution] = useState(p.resolution === '1080p' ? '720p' : p.resolution || '720p')
  const [seconds, setSeconds] = useState(p.seconds || 5)
  const [progress, setProgress] = useState(0)
  const [genErr, setGenErr] = useState('') // 生成器自身的校验提示（不改节点状态）
  const upFileRef = useRef<HTMLInputElement | null>(null)
  const playerRef = useRef<HTMLAudioElement | null>(null)
  const runIdRef = useRef<string>('')

  const set = (patch: Partial<VideoGenShape['props']>): void =>
    editor.updateShape<VideoGenShape>({ id: shape.id, type: 'videoGen', props: patch })

  // 结果节点：用存在自己身上的请求生成、填回本节点（带进度/取消/重试）
  async function runSelf(): Promise<void> {
    if (!ctx.videoApiKey) {
      set({ status: 'error', error: '请先在「设置 → 视频生成」填入 API 密钥' })
      ctx.openSettings('video')
      return
    }
    const references = parseVRefs(p.refs)
    const audioUrls = parseAudios(p.audios)
    const videoUrls = parseAudios(p.videos)
    set({ status: 'loading', error: '' })
    setProgress(0)
    const submittedAt = Date.now()
    const runId = shape.id + '_' + submittedAt
    runIdRef.current = runId
    const off = window.api.onVideoProgress((pct) => setProgress(pct))
    try {
      let url = ''
      if (ctx.videoApiType === 'task521' || /521xxz\.com/i.test(ctx.videoBaseURL)) {
        const r = await window.api.task521Video({
          baseURL: ctx.videoBaseURL,
          apiKey: ctx.videoApiKey,
          model: p.model,
          prompt: p.prompt,
          seconds: Number(p.seconds) || 5,
          aspectRatio: p.ratio,
          resolution: p.resolution,
          references: references.length ? references : undefined,
          audioUrls: audioUrls.length ? audioUrls : undefined,
          videoUrls: videoUrls.length ? videoUrls : undefined,
          generateAudio: p.audio,
          runId
        })
        url = r.url
      } else {
        const r = await window.api.videoGenerate({
          baseURL: ctx.videoBaseURL,
          apiKey: ctx.videoApiKey,
          model: p.model,
          prompt: p.prompt
        })
        url = r.url
      }
      if (!url) throw new Error('未返回视频')
      const dim = await loadVideoDim(url)
      set({ src: url, status: 'idle', w: VW, h: Math.round((VW * dim.h) / dim.w) })
      recordUsage({ kind: 'video', model: p.model, submittedAt, status: 'success' })
    } catch (e) {
      const msg = (e as Error).message
      if (msg === '已取消') {
        set({ status: 'error', error: '已取消' })
      } else {
        set({ status: 'error', error: msg })
        recordUsage({ kind: 'video', model: p.model, submittedAt, status: 'error', error: msg })
      }
    } finally {
      off()
    }
  }

  // 老的视频生成器尺寸补到 520×360（编辑框够大，和图片款一致）
  useEffect(() => {
    if (isGenerator && (p.w < 520 || p.h < 360)) set({ w: Math.max(p.w, 520), h: Math.max(p.h, 360) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 结果节点（loading）首次挂载 → 自动开跑
  useEffect(() => {
    if (!isGenerator && p.status === 'loading' && !STARTED_VIDEOS.has(shape.id)) {
      STARTED_VIDEOS.add(shape.id)
      void runSelf()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGenerator, p.status])

  // 取消当前生成（结果节点）
  const cancel = (): void => {
    if (runIdRef.current) window.api.task521Cancel?.(runIdRef.current)
  }
  // 点小缩略图播放 / 暂停音频
  const playAudio = (src: string): void => {
    const el = playerRef.current
    if (!el) return
    if (el.src === src && !el.paused) {
      el.pause()
      return
    }
    el.src = src
    void el.play().catch(() => {})
  }

  // 手动附加的参考图（上传 / 素材库），带角色，多张无上限
  const attached = parseVRefs(p.refs)
  const addRefs = (srcs: string[]): void => {
    if (!srcs.length) return
    const add: VRef[] = srcs.map((u) => ({ url: u, role: 'reference_image' }))
    set({ refs: JSON.stringify([...parseVRefs(p.refs), ...add]) })
  }
  const removeRef = (i: number): void => {
    const a = parseVRefs(p.refs)
    a.splice(i, 1)
    set({ refs: JSON.stringify(a) })
  }
  // 点角色标循环切换：参考图 → 首帧 → 尾帧
  const cycleRole = (i: number): void => {
    const a = parseVRefs(p.refs)
    if (!a[i]) return
    a[i].role = ROLE_ORDER[(ROLE_ORDER.indexOf(a[i].role) + 1) % ROLE_ORDER.length]
    set({ refs: JSON.stringify(a) })
  }
  // 参考音频（最多 3）
  const audios = parseAudios(p.audios)
  const addAudios = (srcs: string[]): void => {
    if (!srcs.length) return
    set({ audios: JSON.stringify([...parseAudios(p.audios), ...srcs].slice(0, 3)) })
  }
  const removeAudio = (i: number): void => {
    const a = parseAudios(p.audios)
    a.splice(i, 1)
    set({ audios: JSON.stringify(a) })
  }
  // 参考视频（最多 3）
  const videos = parseAudios(p.videos)
  const addVideos = (srcs: string[]): void => {
    if (!srcs.length) return
    set({ videos: JSON.stringify([...parseAudios(p.videos), ...srcs].slice(0, 3)) })
  }
  const removeVideo = (i: number): void => {
    const a = parseAudios(p.videos)
    a.splice(i, 1)
    set({ videos: JSON.stringify(a) })
  }

  // 统一添加：按 dataURL 类型自动归类到 图片 / 音频 / 视频
  const addMaterials = (srcs: string[]): void => {
    const imgs: string[] = []
    const auds: string[] = []
    const vids: string[] = []
    for (const s of srcs) {
      if (/^data:audio\//i.test(s)) auds.push(s)
      else if (/^data:video\//i.test(s)) vids.push(s)
      else imgs.push(s)
    }
    if (imgs.length) addRefs(imgs)
    if (auds.length) addAudios(auds)
    if (vids.length) addVideos(vids)
  }
  const onUploadMaterials = (e: ChangeEvent<HTMLInputElement>): void => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    Promise.all(
      files.map(
        (f) =>
          new Promise<string>((res) => {
            const fr = new FileReader()
            fr.onload = () => res(fr.result as string)
            fr.onerror = () => res('')
            fr.readAsDataURL(f)
          })
      )
    ).then((srcs) => addMaterials(srcs.filter(Boolean)))
  }

  // 收集连进来的上游音频（音频节点）
  function upstreamAudio(): string[] {
    const out: string[] = []
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toB = editor.getBindingsToShape(shape.id, 'arrow') as any[]
      for (const b of toB) {
        if (b.props?.terminal !== 'end') continue
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fromB = editor.getBindingsFromShape(b.fromId, 'arrow') as any[]
        for (const s of fromB) {
          if (s.props?.terminal !== 'start') continue
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const src = editor.getShape(s.toId) as any
          if (src && src.type === 'audioNode' && src.props.src) out.push(src.props.src as string)
        }
      }
    } catch {
      /* ignore */
    }
    return out
  }

  // 收集所有连进来的上游图片（图片节点）当首帧/参考图，带名称（节点的「名称」）
  function upstreamRefs(): { url: string; name: string }[] {
    const out: { url: string; name: string }[] = []
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toB = editor.getBindingsToShape(shape.id, 'arrow') as any[]
      for (const b of toB) {
        if (b.props?.terminal !== 'end') continue
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fromB = editor.getBindingsFromShape(b.fromId, 'arrow') as any[]
        for (const s of fromB) {
          if (s.props?.terminal !== 'start') continue
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

  // 生成器始终查上游连线（连进来的参考图/音频随时显示）；结果节点不需要
  const upRefs = isGenerator ? upstreamRefs() : []
  const upAudios = isGenerator ? upstreamAudio() : []

  // @ 提及：seedance2 用 @image1/@image2…（按 content 里图片顺序：先手动附加，再连线进来的）
  const mentionItems = [
    ...attached.map((r, i) => ({ key: 'a' + i, name: `image${i + 1}`, thumb: r.url })),
    ...upRefs.map((r, i) => ({
      key: 'u' + i,
      name: `image${attached.length + i + 1}`,
      thumb: r.url
    }))
  ]

  // 生成器：点生成 → 连出一个结果视频节点（loading），由结果自己开跑
  async function run(): Promise<void> {
    if (!ctx.videoApiKey) {
      setGenErr('请先在「设置 → 视频生成」填入 API 密钥')
      ctx.openSettings('video')
      return
    }
    if (!prompt.trim()) {
      setGenErr('请输入提示词')
      return
    }
    const references: VRef[] = [
      ...parseVRefs(p.refs),
      ...upstreamRefs().map((u): VRef => ({ url: u.url, role: 'reference_image' }))
    ]
    const audioUrls = [...parseAudios(p.audios), ...upstreamAudio()].slice(0, 3)
    const videoUrls = parseAudios(p.videos).slice(0, 3)
    if ((audioUrls.length || videoUrls.length) && !references.length) {
      setGenErr('用参考音频 / 视频时，必须至少连/传 1 张参考图')
      return
    }
    setGenErr('')
    set({ prompt, model, ratio, resolution, seconds })

    // 连出新结果节点（每点一次多一个，按已有输出数往下错开）
    const b = editor.getShapePageBounds(shape)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toB = editor.getBindingsToShape(shape.id, 'arrow') as any[]
    const outCount = toB.filter((bd) => bd.props?.terminal === 'start').length
    const rid = createShapeId()
    editor.createShape<VideoGenShape>({
      id: rid,
      type: 'videoGen',
      x: (b?.maxX ?? shape.x) + 80,
      y: (b?.minY ?? shape.y) + outCount * 260,
      // 把这次生成的请求存到结果节点上，失败时可在结果节点直接「重试」
      props: {
        w: 320,
        h: 200,
        src: '',
        status: 'loading',
        error: '',
        prompt,
        model,
        ratio,
        resolution,
        seconds: Number(seconds) || 5,
        refs: JSON.stringify(references),
        audios: JSON.stringify(audioUrls),
        videos: JSON.stringify(videoUrls),
        audio: p.audio
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
  }

  function removeNode(): void {
    editor.deleteShapes([shape.id])
  }
  async function downloadVideo(): Promise<void> {
    if (!p.src) return
    await window.api.saveImage({ url: p.src, defaultName: `video-${shape.id}.mp4` })
  }

  const modelOptions = model && !ctx.videoModels.includes(model) ? [model, ...ctx.videoModels] : ctx.videoModels

  const ports = (
    <>
      <button
        className="node-port in"
        onPointerDown={(e) => {
          e.stopPropagation()
          e.preventDefault()
          ctx.startConnect(shape.id, e.clientX, e.clientY, 'in')
        }}
        title="输入：连一张图当首帧/参考"
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

  // ===== 结果视频节点：视频 / 加载(取消) / 失败(重试·删除) + 工具 =====
  if (!isGenerator) {
    return (
      <div className="vnode" style={{ width: p.w, height: p.h }} data-selected={selected}>
        <div className="vnode-label">🎬 视频</div>
        <div className="vnode-video">
          {p.status === 'loading' ? (
            <div className="vnode-loading" onPointerDown={stopEventPropagation}>
              <div className="node-spin" />
              <div className="vnode-pct">{progress > 0 ? `生成中 ${progress}%` : '提交中 / 排队…'}</div>
              <button className="node-cancel" onClick={cancel}>
                ✕ 取消
              </button>
            </div>
          ) : p.status === 'error' ? (
            <div className="vnode-loading vnode-errbox" onPointerDown={stopEventPropagation}>
              <div className="vnode-errmsg" title={p.error}>
                ⚠ {p.error}
              </div>
              <div className="vnode-errbtns">
                <button className="node-retry" onClick={() => void runSelf()}>
                  ↻ 重试
                </button>
                <button className="node-cancel" onClick={removeNode}>
                  🗑 删除
                </button>
              </div>
            </div>
          ) : (
            <video src={p.src} controls />
          )}
        </div>

        {p.src && (
          <div className="node-tools" onPointerDown={stopEventPropagation}>
            <button onClick={downloadVideo} title="下载视频">
              <span className="tt-ic">⬇</span> 下载
            </button>
            <button className="tt-del" onClick={removeNode} title="删除">
              <span className="tt-ic">🗑</span> 删除
            </button>
          </div>
        )}
        {ports}
        <ResizeHandle editor={editor} shapeId={shape.id} minW={160} minH={120} />
      </div>
    )
  }

  // ===== 生成器：编辑框（参考素材 + 配音 + 提示词 + 模型/比例/分辨率/时长 + 发送），点生成连出结果视频 =====
  return (
    <div className="vnode vnode-generator" style={{ width: p.w }} data-selected={selected}>
      <div className="vnode-label vnode-drag" title="拖动可移动节点">
        <span>🎬 视频生成</span>
        <button className="node-gen-del" onPointerDown={stopEventPropagation} onClick={removeNode} title="删除生成器">
          🗑
        </button>
      </div>
      <div className="vnode-genbox" onPointerDown={stopEventPropagation} onWheel={(e) => e.stopPropagation()}>
        {/* 参考素材：一个「上传」+「素材库」，图片/音频/视频自动归类；🔊 自动配音开关 */}
        <div className="node-refs">
          <div className="node-refs-head">
            <span className="node-refs-title">
              参考素材
              {attached.length + upRefs.length + videos.length + audios.length + upAudios.length > 0
                ? ` · ${attached.length + upRefs.length + videos.length + audios.length + upAudios.length}`
                : ''}
            </span>
            <button
              className={'node-audiobtn' + (p.audio ? ' on' : '')}
              onClick={() => set({ audio: !p.audio })}
              title={p.audio ? 'AI 自动配音：开（让模型生成音效/配乐，点击关闭）' : 'AI 自动配音：关（点击开启）'}
            >
              {p.audio ? '🔊 配音开' : '🔇 配音关'}
            </button>
            <button className="node-refbtn" onClick={() => upFileRef.current?.click()} title="上传 图片 / 音频 / 视频（可多选）">
              ⬆ 上传
            </button>
            <button className="node-refbtn" onClick={() => ctx.pickAssets(addMaterials)} title="从素材库选择（图片 / 音频 / 视频）">
              📦 素材库
            </button>
            <input ref={upFileRef} type="file" accept="image/*,audio/*,video/*" multiple hidden onChange={onUploadMaterials} />
          </div>
          {attached.length + upRefs.length + videos.length + audios.length + upAudios.length > 0 && (
            <div className="node-refthumbs">
              {/* 图片 */}
              {attached.map((r, i) => (
                <span className="node-refthumb" key={'a' + i}>
                  <img src={r.url} alt="" />
                  <button
                    className={'node-refrole role-' + r.role}
                    title={`用作「${ROLE_NAME[r.role]}」· 点击切换（参考图→首帧→尾帧）`}
                    onClick={() => cycleRole(i)}
                  >
                    {ROLE_SHORT[r.role]}
                  </button>
                  <button className="node-refx" title="移除" onClick={() => removeRef(i)}>
                    ×
                  </button>
                </span>
              ))}
              {upRefs.map((r, i) => (
                <span className="node-refthumb node-refthumb-link" key={'u' + i} title={`来自连线「${r.name || '图片' + (i + 1)}」（默认当参考图，在源节点处管理）`}>
                  <img src={r.url} alt="" />
                  <span className="node-reflink">链</span>
                </span>
              ))}
              {/* 视频 */}
              {videos.map((src, i) => (
                <span className="node-refthumb" key={'vv' + i} title="参考视频">
                  <video src={src} muted />
                  <span className="node-medialbl">🎬</span>
                  <button className="node-refx" title="移除" onClick={() => removeVideo(i)}>
                    ×
                  </button>
                </span>
              ))}
              {/* 音频（点击播放） */}
              {audios.map((src, i) => (
                <span className="node-refthumb node-audiothumb" key={'aa' + i} title="点击播放 / 暂停" onClick={() => playAudio(src)}>
                  <span className="audio-ico">🎵</span>
                  <button
                    className="node-refx"
                    title="移除"
                    onClick={(e) => {
                      e.stopPropagation()
                      removeAudio(i)
                    }}
                  >
                    ×
                  </button>
                </span>
              ))}
              {upAudios.map((src, i) => (
                <span
                  className="node-refthumb node-audiothumb node-refthumb-link"
                  key={'ua' + i}
                  title="来自连线的音频节点 · 点击播放"
                  onClick={() => playAudio(src)}
                >
                  <span className="audio-ico">🎵</span>
                  <span className="node-reflink">链</span>
                </span>
              ))}
            </div>
          )}
          <audio ref={playerRef} hidden />
        </div>
        <MentionInput
          className="vnode-prompt"
          value={prompt}
          placeholder="描述内容…（输入 @ 引用素材，回车生成）"
          items={mentionItems}
          onChange={setPrompt}
          onEnter={() => void run()}
        />
        <div className="vnode-bar">
          <select className="vnode-sel vnode-model" value={model} onChange={(e) => setModel(e.target.value)} title="视频模型">
            {modelOptions.length ? (
              modelOptions.map((m) => (
                <option key={m} value={m}>
                  {prettifyModel(m)}
                </option>
              ))
            ) : (
              <option value="">无模型</option>
            )}
          </select>
          <select className="vnode-sel" value={ratio} onChange={(e) => setRatio(e.target.value)} title="比例">
            {RATIOS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <select className="vnode-sel" value={resolution} onChange={(e) => setResolution(e.target.value)} title="分辨率">
            {RESOLUTIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <select className="vnode-sel" value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} title="时长（秒）">
            {DURATIONS.map((d) => (
              <option key={d} value={d}>
                {d}s
              </option>
            ))}
          </select>
          <button className="vnode-send" onClick={() => void run()} title="生成">
            ↑
          </button>
        </div>
        {genErr && <div className="node-err">{genErr}</div>}
      </div>
      {ports}
      <ResizeHandle editor={editor} shapeId={shape.id} minW={420} minH={320} />
    </div>
  )
})

const videoGenVersions = createShapePropsMigrationIds('videoGen', {
  AddRefs: 1,
  AddAudio: 2,
  AddAudios: 3,
  AddVideos: 4
})

export class VideoGenUtil extends BaseBoxShapeUtil<VideoGenShape> {
  static override type = 'videoGen' as const
  static override props: RecordProps<VideoGenShape> = {
    w: T.number,
    h: T.number,
    src: T.string,
    prompt: T.string,
    model: T.string,
    ratio: T.string,
    resolution: T.string,
    seconds: T.number,
    refs: T.string,
    audios: T.string,
    videos: T.string,
    audio: T.boolean,
    status: T.string,
    error: T.string
  }

  static override migrations = createShapePropsMigrationSequence({
    sequence: [
      {
        id: videoGenVersions.AddRefs,
        up(props: Record<string, unknown>) {
          props.refs = '[]'
        }
      },
      {
        id: videoGenVersions.AddAudio,
        up(props: Record<string, unknown>) {
          props.audio = true
        }
      },
      {
        id: videoGenVersions.AddAudios,
        up(props: Record<string, unknown>) {
          props.audios = '[]'
        }
      },
      {
        id: videoGenVersions.AddVideos,
        up(props: Record<string, unknown>) {
          props.videos = '[]'
        }
      }
    ]
  })

  getDefaultProps(): VideoGenShape['props'] {
    return {
      w: 520,
      h: 360,
      src: '',
      prompt: '',
      model: '',
      ratio: '16:9',
      resolution: '720p',
      seconds: 5,
      refs: '[]',
      audios: '[]',
      videos: '[]',
      audio: true,
      status: 'idle',
      error: ''
    }
  }

  component(shape: VideoGenShape): JSX.Element {
    return (
      <HTMLContainer style={{ width: shape.props.w, height: shape.props.h, overflow: 'visible', pointerEvents: 'all' }}>
        <VideoBody shape={shape} />
      </HTMLContainer>
    )
  }

  override getIndicatorPath(shape: VideoGenShape): Path2D {
    const path = new Path2D()
    path.roundRect(0, 0, shape.props.w, shape.props.h, 14)
    return path
  }
}
