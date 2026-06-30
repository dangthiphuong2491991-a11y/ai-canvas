import { useRef, useState, useContext, type ChangeEvent } from 'react'
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  useEditor,
  track,
  stopEventPropagation,
  T,
  type TLBaseShape,
  type RecordProps
} from 'tldraw'
import { GenContext } from './genNode'
import { ResizeHandle } from './nodeResize'

export type VideoPromptShape = TLBaseShape<
  'videoPrompt',
  { w: number; h: number; videoSrc: string; prompt: string; model: string; status: string; error: string }
>

const VW = 320

// 按 fps 从视频抽帧（均匀分布，上限 maxFrames），返回 jpeg dataURL 数组 + 各帧时间戳。
// 远程无 CORS 视频会被画布污染→toDataURL 失败，返回空。
function extractFrames(
  src: string,
  fps = 2,
  maxFrames = 16
): Promise<{ frames: string[]; duration: number }> {
  return new Promise((resolve) => {
    const v = document.createElement('video')
    v.src = src
    v.muted = true
    v.crossOrigin = 'anonymous'
    v.preload = 'auto'
    const frames: string[] = []
    let canvas: HTMLCanvasElement
    let ctx2: CanvasRenderingContext2D | null
    v.onloadedmetadata = () => {
      const dur = v.duration && isFinite(v.duration) ? v.duration : 1
      const w = Math.min(v.videoWidth || 640, 640)
      const h = Math.round((w * (v.videoHeight || 360)) / (v.videoWidth || 640))
      canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      ctx2 = canvas.getContext('2d')
      const count = Math.max(4, Math.min(maxFrames, Math.round(dur * fps)))
      const times = Array.from({ length: count }, (_, i) => (dur * (i + 0.5)) / count)
      let i = 0
      const grab = (): void => {
        if (i >= times.length) {
          resolve({ frames, duration: dur })
          return
        }
        v.currentTime = Math.min(times[i], Math.max(0, dur - 0.05))
      }
      v.onseeked = () => {
        try {
          ctx2?.drawImage(v, 0, 0, canvas.width, canvas.height)
          frames.push(canvas.toDataURL('image/jpeg', 0.75))
        } catch {
          /* tainted canvas (远程视频无 CORS) */
        }
        i++
        grab()
      }
      grab()
    }
    v.onerror = () => resolve({ frames, duration: 0 })
  })
}

// 视频反推默认指令（资深影视分镜师 / AI 视频逆向分析）
const REVERSE_PROMPT = `你是一位资深的影视分镜师与 AI 视频逆向分析专家。请仔细、按时间顺序逐帧观看本次输入的视频，把它逆向拆解成一份**完整、可复现的分镜脚本**。目标是：别人不看视频、只读你的文字，就能用 AI 视频工具重新生成出几乎一样的视频。

请严格按下面两大部分输出，全程使用中文。描述要客观、具体、可执行，多用可观察到的画面信息，少用主观感受词。

==================== 第一部分：前置设定要求 ====================

依次给出以下设定，逐条列出，不要省略：

1. 角色设定：为视频中每个出场人物单独描述——性别、大致年龄、发型与发色、面部特征（脸型、胡须、皱纹、是否戴眼镜等）、体型、性格表现、典型动作特征。
2. 声音设定：为每个有台词的人物描述音色，统一用【…·…·…】格式，例如【中低频沙哑喉音·语速急促·气息浑浊】，涵盖音高、清晰度、语速、情绪质感。
3. 服装描述：逐个人物描述外套、内搭、颜色、版型、配饰（项链 / 眼镜 / 胸花 / 腰带 / 包 等）。
4. 背景设定：先给"场景名"，再写详细描述（墙体材质、建筑门窗、地面、光线方向与明暗、时间氛围）。
5. 场景设定：描述三维空间布局（前景 / 中景 / 背景分别有什么、人物如何围绕道具站位形成什么格局）＋ 细节布置（桌上、墙上等具体物品的摆放）。
6. 道具设定：列出关键道具并简述外观。
7. 人物位置：写"初始站位"——以观众视角说明谁在画面左 / 右、面朝哪一侧、谁在谁的前方 / 后方。

==================== 第二部分：分镜脚本（按时间分组） ====================

把视频按时间顺序切成若干"组"，每组是一个小情节单元，**每组总时长不超过 15 秒**。每组开头写：

第X组：[本组主题，如"对峙与试探"]
时间线：[起始时间 - 结束时间] 总时长：X秒
场景：… | 人物：… | 道具：… | 时间：… | 天气：…

然后在组内逐个镜头展开，每个镜头严格用以下格式：

[镜头 N]
时间线：起 至 止 | 总用时：X秒 | 运镜景别：（景别 + 运镜方式）
画面内容：（这一镜画面上发生了什么——主体、表情、动作、眼神朝向、构图、景别变化）
音效：（人声 / 环境音 / 欢呼声 / 脚步声 / 音乐 等）
台词信息：[说话人] + [该人物的声音描述符]
台词内容："台词原文"（逐字转写；本镜无台词则写"无台词"，画外音请注明"（画外音）"）

==================== 输出规则 ====================

- 景别用专业术语：远景 / 全景 / 中景 / 近景 / 特写 / 大特写 / 过肩。运镜方式用：固定 / 推 / 拉 / 摇 / 移 / 跟 / 俯拍 / 仰拍。
- 时间戳统一用「分:秒.百分秒」格式（如 00:04.00、01:13.00），并尽量贴合视频的实际节奏。
- 单个镜头时长尽量控制在 5 秒以内；画面切换频繁时如实拆分成多镜。
- 同一句台词若跨越多个镜头切换，台词信息中的说话人保持一致。
- 没有台词、只有画面或动作的镜头，"画面内容"照常详细描写，"台词内容"写"无台词"。
- 只描述画面中能看到、能听到的客观信息，不要补充剧情之外的主观脑补。
- 直接从第一部分开始输出，不要写"好的""以下是"之类的开场白。

（说明：以下按时间顺序提供该视频抽取的关键帧，请据此逆向分析。）`

const VideoBody = track(function VideoBody({ shape }: { shape: VideoPromptShape }) {
  const editor = useEditor()
  const ctx = useContext(GenContext)
  const p = shape.props
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [prompt, setPrompt] = useState(p.prompt)
  const [model, setModel] = useState(() => p.model || ctx.revModel || 'qwen-vl-max')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const revHost = (ctx.revBaseURL || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '')

  const set = (patch: Partial<VideoPromptShape['props']>): void =>
    editor.updateShape({ id: shape.id, type: 'videoPrompt', props: patch })

  function onPickFile(e: ChangeEvent<HTMLInputElement>): void {
    const f = e.target.files?.[0]
    if (!f) return
    const fr = new FileReader()
    fr.onload = () => set({ videoSrc: fr.result as string })
    fr.readAsDataURL(f)
    e.target.value = ''
  }

  async function reverse(): Promise<void> {
    // 反推走独立接口（Qwen/DashScope）；没单独配 key 就回退到主接口
    const baseURL = ctx.revApiKey ? ctx.revBaseURL : ctx.baseURL
    const apiKey = ctx.revApiKey || ctx.apiKey
    if (!apiKey) {
      setErr('请先在「设置 → 视频反推」填入反推接口密钥（Qwen/DashScope）')
      ctx.openSettings('reverse')
      return
    }
    if (!p.videoSrc) {
      setErr('请先上传转绘视频')
      return
    }
    setBusy(true)
    setErr('')
    set({ status: 'loading', error: '' })
    try {
      const { frames } = await extractFrames(p.videoSrc, ctx.revFps || 2, 16)
      if (!frames.length) throw new Error('没抽到帧（远程视频可能跨域，建议上传本地视频）')
      const text = await window.api.visionGenerate({
        baseURL,
        apiKey,
        model: model || ctx.revModel,
        prompt: REVERSE_PROMPT,
        images: frames
      })
      setPrompt(text)
      set({ prompt: text, model, status: 'idle' })
    } catch (e) {
      setErr((e as Error).message)
      set({ status: 'error', error: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="vpnode" style={{ width: p.w, height: p.h }}>
      <div className="vpnode-label">🎞️ 视频反推</div>
      <div className="vpnode-body" onPointerDown={stopEventPropagation} onWheel={(e) => e.stopPropagation()}>
        <div className="vpnode-video">
          {p.videoSrc ? (
            <video src={p.videoSrc} controls muted />
          ) : (
            <button className="vpnode-upload" onClick={() => fileRef.current?.click()}>
              ⬆ 上传视频
            </button>
          )}
          {p.videoSrc && (
            <button className="vpnode-rep" onClick={() => fileRef.current?.click()} title="换一个视频">
              ↻
            </button>
          )}
        </div>
        <input ref={fileRef} type="file" accept="video/*" hidden onChange={onPickFile} />
        <div className="vpnode-row">
          <input
            className="node-sel vpnode-model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            onBlur={() => set({ model })}
            placeholder="qwen-vl-max"
            title={'反推模型（接口：' + (revHost || '未配置') + '，在 设置→视频反推 里配）'}
          />
          <button className="vpnode-btn" onClick={reverse} disabled={busy || !p.videoSrc}>
            {busy ? '反推中…' : '反推提示词'}
          </button>
        </div>
        <div className="vpnode-hint">接口：{revHost || '未配置（设置→视频反推）'} · 抽帧 {ctx.revFps || 2}fps</div>
        <textarea
          className="vpnode-prompt"
          placeholder="反推出的提示词会显示在这里，可编辑，连线给图片/视频生成节点…"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onBlur={() => set({ prompt })}
        />
        {err && <div className="gp-err">{err}</div>}
      </div>

      {/* 输出口：拖到图片/视频生成节点 */}
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
      <ResizeHandle editor={editor} shapeId={shape.id} minW={260} minH={200} />
    </div>
  )
})

export class VideoPromptUtil extends BaseBoxShapeUtil<VideoPromptShape> {
  static override type = 'videoPrompt' as const
  static override props: RecordProps<VideoPromptShape> = {
    w: T.number,
    h: T.number,
    videoSrc: T.string,
    prompt: T.string,
    model: T.string,
    status: T.string,
    error: T.string
  }

  getDefaultProps(): VideoPromptShape['props'] {
    return { w: VW, h: 380, videoSrc: '', prompt: '', model: '', status: 'idle', error: '' }
  }

  component(shape: VideoPromptShape): JSX.Element {
    return (
      <HTMLContainer style={{ width: shape.props.w, height: shape.props.h, overflow: 'visible', pointerEvents: 'all' }}>
        <VideoBody shape={shape} />
      </HTMLContainer>
    )
  }

  override getIndicatorPath(shape: VideoPromptShape): Path2D {
    const path = new Path2D()
    path.roundRect(0, 0, shape.props.w, shape.props.h, 14)
    return path
  }
}
