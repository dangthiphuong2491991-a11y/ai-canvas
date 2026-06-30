import { useRef, useContext, type ChangeEvent } from 'react'
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

export type AudioNodeShape = TLBaseShape<
  'audioNode',
  {
    w: number
    h: number
    src: string // 音频 dataURL / URL
    name: string
  }
>

const AW = 260

// 复用 readImageFiles 的逻辑读任意文件为 dataURL（这里读音频）
function readAudioFile(files: FileList | null): Promise<string> {
  const f = Array.from(files || []).find((x) => x.type.startsWith('audio/'))
  if (!f) return Promise.resolve('')
  return new Promise((res) => {
    const fr = new FileReader()
    fr.onload = () => res(fr.result as string)
    fr.onerror = () => res('')
    fr.readAsDataURL(f)
  })
}

const AudioBody = track(function AudioBody({ shape }: { shape: AudioNodeShape }) {
  const editor = useEditor()
  const ctx = useContext(GenContext)
  const p = shape.props
  const fileRef = useRef<HTMLInputElement | null>(null)

  const set = (patch: Partial<AudioNodeShape['props']>): void =>
    editor.updateShape<AudioNodeShape>({ id: shape.id, type: 'audioNode', props: patch })

  const onUpload = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const f = e.target.files?.[0]
    const name = f ? f.name.replace(/\.[^.]+$/, '') : ''
    const src = await readAudioFile(e.target.files)
    e.target.value = ''
    if (src) set({ src, name: name || p.name })
  }

  function removeNode(): void {
    editor.deleteShapes([shape.id])
  }

  return (
    <div className="anode" style={{ width: p.w, height: p.h }}>
      <div className="anode-label" title={p.name || '音频节点'}>
        🎵 {p.name || '音频节点'}
      </div>
      <div className="anode-body">
        {p.src ? (
          <audio src={p.src} controls onPointerDown={stopEventPropagation} />
        ) : (
          <div className="anode-empty" onPointerDown={stopEventPropagation}>
            <button className="anode-btn" onClick={() => fileRef.current?.click()}>
              ⬆ 上传音频
            </button>
            <button
              className="anode-btn"
              onClick={() => ctx.pickAssets((srcs) => srcs[0] && set({ src: srcs[0] }))}
            >
              📦 素材库
            </button>
          </div>
        )}
        <input ref={fileRef} type="file" accept="audio/*" hidden onChange={onUpload} />
      </div>

      <div className="node-tools" onPointerDown={stopEventPropagation}>
        {p.src && (
          <button onClick={() => fileRef.current?.click()} title="替换音频">
            ↺
          </button>
        )}
        <button onClick={removeNode} title="删除节点">
          🗑
        </button>
      </div>

      {/* 仅输出口：拖到视频节点当参考音频 */}
      <button
        className="node-port out"
        onPointerDown={(e) => {
          e.stopPropagation()
          e.preventDefault()
          ctx.startConnect(shape.id, e.clientX, e.clientY, 'out')
        }}
        title="输出：拖到视频节点当参考音频"
      >
        ＋
      </button>
      <ResizeHandle editor={editor} shapeId={shape.id} minW={140} minH={90} />
    </div>
  )
})

export class AudioNodeUtil extends BaseBoxShapeUtil<AudioNodeShape> {
  static override type = 'audioNode' as const
  static override props: RecordProps<AudioNodeShape> = {
    w: T.number,
    h: T.number,
    src: T.string,
    name: T.string
  }

  getDefaultProps(): AudioNodeShape['props'] {
    return { w: AW, h: 96, src: '', name: '' }
  }

  component(shape: AudioNodeShape): JSX.Element {
    return (
      <HTMLContainer style={{ width: shape.props.w, height: shape.props.h, overflow: 'visible', pointerEvents: 'all' }}>
        <AudioBody shape={shape} />
      </HTMLContainer>
    )
  }

  override getIndicatorPath(shape: AudioNodeShape): Path2D {
    const path = new Path2D()
    path.roundRect(0, 0, shape.props.w, shape.props.h, 12)
    return path
  }
}
