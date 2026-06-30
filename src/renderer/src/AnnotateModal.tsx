import { useEffect, useRef, useState } from 'react'

type Tool = 'rect' | 'circle' | 'arrow' | 'pen' | 'text'
interface Pt {
  x: number
  y: number
}
interface Shape {
  type: Tool
  color: string
  size: number
  x?: number
  y?: number
  w?: number
  h?: number
  x2?: number
  y2?: number
  pts?: Pt[]
  text?: string
}

const STAGE_W = 900
const STAGE_H = 540
const TOOLS: { id: Tool; label: string }[] = [
  { id: 'rect', label: '矩形' },
  { id: 'circle', label: '圆形' },
  { id: 'arrow', label: '箭头' },
  { id: 'pen', label: '画笔' },
  { id: 'text', label: '文本' }
]

// 标注工具：矩形/圆形/箭头/画笔/文本 + 颜色 + 粗细 + 撤销/重做/清空，应用后拍平到图片
export function AnnotateModal(props: { src: string; onApply: (s: string) => void; onClose: () => void }): JSX.Element {
  const [tool, setTool] = useState<Tool>('rect')
  const [color, setColor] = useState('#ff3b3b')
  const [size, setSize] = useState(4)
  const [shapes, setShapes] = useState<Shape[]>([])
  const [redo, setRedo] = useState<Shape[]>([])
  const [draft, setDraft] = useState<Shape | null>(null)
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const fitRef = useRef({ x: 0, y: 0, w: 0, h: 0 })

  useEffect(() => {
    const img = new Image()
    img.onload = () => {
      const nw = img.naturalWidth || 1024
      const nh = img.naturalHeight || 1024
      setNatural({ w: nw, h: nh })
      const scale = Math.min(STAGE_W / nw, STAGE_H / nh)
      fitRef.current = { x: (STAGE_W - nw * scale) / 2, y: (STAGE_H - nh * scale) / 2, w: nw * scale, h: nh * scale }
    }
    img.src = props.src
  }, [props.src])

  const commit = (s: Shape): void => {
    setShapes((prev) => [...prev, s])
    setRedo([])
  }

  const localPt = (e: React.PointerEvent): Pt => {
    const stage = (e.currentTarget as HTMLElement).getBoundingClientRect()
    return { x: e.clientX - stage.left, y: e.clientY - stage.top }
  }

  const onDown = (e: React.PointerEvent): void => {
    e.stopPropagation()
    const p = localPt(e)
    if (tool === 'text') {
      const text = window.prompt('输入文字')
      if (text) commit({ type: 'text', color, size, x: p.x, y: p.y, text })
      return
    }
    if (tool === 'pen') {
      setDraft({ type: 'pen', color, size, pts: [p] })
    } else {
      setDraft({ type: tool, color, size, x: p.x, y: p.y, x2: p.x, y2: p.y })
    }
  }
  const onMove = (e: React.PointerEvent): void => {
    if (!draft) return
    const p = localPt(e)
    if (draft.type === 'pen') setDraft({ ...draft, pts: [...(draft.pts || []), p] })
    else setDraft({ ...draft, x2: p.x, y2: p.y })
  }
  const onUp = (): void => {
    if (!draft) return
    // 太小的忽略
    if (draft.type !== 'pen' && Math.abs((draft.x2 || 0) - (draft.x || 0)) < 3 && Math.abs((draft.y2 || 0) - (draft.y || 0)) < 3) {
      setDraft(null)
      return
    }
    commit(draft)
    setDraft(null)
  }

  const undo = (): void => {
    setShapes((prev) => {
      if (!prev.length) return prev
      const last = prev[prev.length - 1]
      setRedo((r) => [...r, last])
      return prev.slice(0, -1)
    })
  }
  const redoFn = (): void => {
    setRedo((r) => {
      if (!r.length) return r
      const last = r[r.length - 1]
      setShapes((s) => [...s, last])
      return r.slice(0, -1)
    })
  }

  // 渲染一个形状为 SVG 元素
  const renderShape = (s: Shape, key: string | number): JSX.Element | null => {
    const stroke = s.color
    const sw = s.size
    if (s.type === 'rect') {
      const x = Math.min(s.x!, s.x2!)
      const y = Math.min(s.y!, s.y2!)
      return <rect key={key} x={x} y={y} width={Math.abs(s.x2! - s.x!)} height={Math.abs(s.y2! - s.y!)} fill="none" stroke={stroke} strokeWidth={sw} />
    }
    if (s.type === 'circle') {
      const x = Math.min(s.x!, s.x2!)
      const y = Math.min(s.y!, s.y2!)
      const w = Math.abs(s.x2! - s.x!)
      const h = Math.abs(s.y2! - s.y!)
      return <ellipse key={key} cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} fill="none" stroke={stroke} strokeWidth={sw} />
    }
    if (s.type === 'arrow') {
      const ang = Math.atan2(s.y2! - s.y!, s.x2! - s.x!)
      const a = 10 + sw * 2
      const p1 = `${s.x2! - a * Math.cos(ang - 0.4)},${s.y2! - a * Math.sin(ang - 0.4)}`
      const p2 = `${s.x2! - a * Math.cos(ang + 0.4)},${s.y2! - a * Math.sin(ang + 0.4)}`
      return (
        <g key={key}>
          <line x1={s.x} y1={s.y} x2={s.x2} y2={s.y2} stroke={stroke} strokeWidth={sw} />
          <polyline points={`${p1} ${s.x2},${s.y2} ${p2}`} fill="none" stroke={stroke} strokeWidth={sw} />
        </g>
      )
    }
    if (s.type === 'pen') {
      return <polyline key={key} points={(s.pts || []).map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
    }
    if (s.type === 'text') {
      return (
        <text key={key} x={s.x} y={s.y} fill={stroke} fontSize={14 + s.size * 3} fontWeight={600}>
          {s.text}
        </text>
      )
    }
    return null
  }

  // 应用：把图片 + 标注画到 canvas（坐标从显示空间缩放回原图）
  const apply = (): void => {
    if (!natural) return
    const fit = fitRef.current
    const scale = natural.w / fit.w
    const canvas = document.createElement('canvas')
    canvas.width = natural.w
    canvas.height = natural.h
    const g = canvas.getContext('2d')
    if (!g) return
    const img = new Image()
    img.onload = () => {
      g.drawImage(img, 0, 0, natural.w, natural.h)
      const tx = (v: number): number => (v - fit.x) * scale
      const ty = (v: number): number => (v - fit.y) * scale
      for (const s of shapes) {
        g.strokeStyle = s.color
        g.fillStyle = s.color
        g.lineWidth = s.size * scale
        g.lineCap = 'round'
        g.lineJoin = 'round'
        if (s.type === 'rect') {
          g.strokeRect(tx(Math.min(s.x!, s.x2!)), ty(Math.min(s.y!, s.y2!)), Math.abs(s.x2! - s.x!) * scale, Math.abs(s.y2! - s.y!) * scale)
        } else if (s.type === 'circle') {
          const cx = tx((s.x! + s.x2!) / 2)
          const cy = ty((s.y! + s.y2!) / 2)
          g.beginPath()
          g.ellipse(cx, cy, (Math.abs(s.x2! - s.x!) / 2) * scale, (Math.abs(s.y2! - s.y!) / 2) * scale, 0, 0, Math.PI * 2)
          g.stroke()
        } else if (s.type === 'arrow') {
          const x1 = tx(s.x!)
          const y1 = ty(s.y!)
          const x2 = tx(s.x2!)
          const y2 = ty(s.y2!)
          const ang = Math.atan2(y2 - y1, x2 - x1)
          const a = (10 + s.size * 2) * scale
          g.beginPath()
          g.moveTo(x1, y1)
          g.lineTo(x2, y2)
          g.moveTo(x2 - a * Math.cos(ang - 0.4), y2 - a * Math.sin(ang - 0.4))
          g.lineTo(x2, y2)
          g.lineTo(x2 - a * Math.cos(ang + 0.4), y2 - a * Math.sin(ang + 0.4))
          g.stroke()
        } else if (s.type === 'pen') {
          g.beginPath()
          ;(s.pts || []).forEach((p, i) => (i ? g.lineTo(tx(p.x), ty(p.y)) : g.moveTo(tx(p.x), ty(p.y))))
          g.stroke()
        } else if (s.type === 'text') {
          g.font = `600 ${(14 + s.size * 3) * scale}px sans-serif`
          g.fillText(s.text || '', tx(s.x!), ty(s.y!))
        }
      }
      props.onApply(canvas.toDataURL('image/png'))
      props.onClose()
    }
    img.src = props.src
  }

  return (
    <div className="tm-backdrop" onClick={props.onClose}>
      <div className="tm imgedit" onClick={(e) => e.stopPropagation()}>
        <div className="tm-head">
          <h2>标注工具</h2>
          <button className="tm-x" onClick={props.onClose} title="关闭">
            ✕
          </button>
        </div>
        <div className="imgedit-bar">
          {TOOLS.map((t) => (
            <button key={t.id} className={'imgedit-chip' + (t.id === tool ? ' on' : '')} onClick={() => setTool(t.id)}>
              {t.label}
            </button>
          ))}
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="anno-color" title="颜色" />
          <input type="range" min={1} max={20} value={size} onChange={(e) => setSize(Number(e.target.value))} className="anno-size" title="粗细" />
          <button className="imgedit-chip" onClick={undo} disabled={!shapes.length}>
            ↶ 撤销
          </button>
          <button className="imgedit-chip" onClick={redoFn} disabled={!redo.length}>
            ↷ 重做
          </button>
          <button className="imgedit-chip" onClick={() => { setShapes([]); setRedo([]) }} disabled={!shapes.length}>
            🗑 清空
          </button>
        </div>
        <div
          className="imgedit-stage"
          style={{ width: STAGE_W, height: STAGE_H, cursor: tool === 'text' ? 'text' : 'crosshair' }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
        >
          <img src={props.src} className="imgedit-img" draggable={false} alt="" />
          <svg className="anno-svg" width={STAGE_W} height={STAGE_H}>
            {shapes.map((s, i) => renderShape(s, i))}
            {draft && renderShape(draft, 'draft')}
          </svg>
        </div>
        <div className="imgedit-foot">
          <button onClick={props.onClose}>取消</button>
          <button className="primary" onClick={apply}>
            应用
          </button>
        </div>
      </div>
    </div>
  )
}
