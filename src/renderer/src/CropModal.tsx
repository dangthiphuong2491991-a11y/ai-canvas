import { useEffect, useRef, useState } from 'react'

type Ratio = { label: string; value: number | null } // null = 原图比例 / 自定义
const RATIOS: Ratio[] = [
  { label: '原图比例', value: 0 },
  { label: '1:1', value: 1 },
  { label: '16:9', value: 16 / 9 },
  { label: '9:16', value: 9 / 16 },
  { label: '4:3', value: 4 / 3 },
  { label: '3:4', value: 3 / 4 },
  { label: '自定义', value: null }
]

const STAGE_W = 900
const STAGE_H = 540

// 裁剪工具：比例预设 + 可拖动/缩放的裁剪框，应用后输出 dataURL
export function CropModal(props: { src: string; onApply: (s: string) => void; onClose: () => void }): JSX.Element {
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const [ratioIdx, setRatioIdx] = useState(0)
  // 裁剪框（显示坐标，相对 stage 左上）
  const [rect, setRect] = useState({ x: 0, y: 0, w: 0, h: 0 })
  const fitRef = useRef({ x: 0, y: 0, w: 0, h: 0 }) // 图片在 stage 里的显示区域
  const drag = useRef<{ mode: 'move' | 'br' | null; sx: number; sy: number; r: typeof rect }>({
    mode: null,
    sx: 0,
    sy: 0,
    r: rect
  })

  // 计算图片显示区域 + 初始裁剪框
  useEffect(() => {
    const img = new Image()
    img.onload = () => {
      const nw = img.naturalWidth || 1024
      const nh = img.naturalHeight || 1024
      setNatural({ w: nw, h: nh })
      const scale = Math.min(STAGE_W / nw, STAGE_H / nh)
      const w = nw * scale
      const h = nh * scale
      const x = (STAGE_W - w) / 2
      const y = (STAGE_H - h) / 2
      fitRef.current = { x, y, w, h }
      setRect({ x, y, w, h }) // 默认全图
    }
    img.src = props.src
  }, [props.src])

  // 应用比例：在图片显示区域内取最大居中的该比例框
  const applyRatio = (idx: number): void => {
    setRatioIdx(idx)
    const r = RATIOS[idx]
    const fit = fitRef.current
    if (r.value === null) return // 自定义：保持当前框
    let ratio = r.value
    if (r.value === 0) ratio = fit.w / fit.h // 原图比例
    let w = fit.w
    let h = w / ratio
    if (h > fit.h) {
      h = fit.h
      w = h * ratio
    }
    setRect({ x: fit.x + (fit.w - w) / 2, y: fit.y + (fit.h - h) / 2, w, h })
  }

  const lockRatio = (): number | null => {
    const r = RATIOS[ratioIdx]
    if (r.value === null) return null
    if (r.value === 0) return fitRef.current.w / fitRef.current.h
    return r.value
  }

  const onDown = (e: React.PointerEvent, mode: 'move' | 'br'): void => {
    e.stopPropagation()
    e.preventDefault()
    drag.current = { mode, sx: e.clientX, sy: e.clientY, r: { ...rect } }
    const move = (ev: PointerEvent): void => {
      const d = drag.current
      if (!d.mode) return
      const dx = ev.clientX - d.sx
      const dy = ev.clientY - d.sy
      const fit = fitRef.current
      if (d.mode === 'move') {
        let x = d.r.x + dx
        let y = d.r.y + dy
        x = Math.max(fit.x, Math.min(x, fit.x + fit.w - d.r.w))
        y = Math.max(fit.y, Math.min(y, fit.y + fit.h - d.r.h))
        setRect({ ...d.r, x, y })
      } else {
        let w = Math.max(20, d.r.w + dx)
        const lock = lockRatio()
        let h = lock ? w / lock : Math.max(20, d.r.h + dy)
        // 不超出图片
        w = Math.min(w, fit.x + fit.w - d.r.x)
        h = lock ? w / lock : Math.min(h, fit.y + fit.h - d.r.y)
        if (lock) w = h * lock
        setRect({ ...d.r, w, h })
      }
    }
    const up = (): void => {
      drag.current.mode = null
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const apply = (): void => {
    if (!natural) return
    const fit = fitRef.current
    const scale = natural.w / fit.w // 显示→原图
    const cx = Math.round((rect.x - fit.x) * scale)
    const cy = Math.round((rect.y - fit.y) * scale)
    const cw = Math.round(rect.w * scale)
    const ch = Math.round(rect.h * scale)
    const canvas = document.createElement('canvas')
    canvas.width = cw
    canvas.height = ch
    const g = canvas.getContext('2d')
    if (!g) return
    const img = new Image()
    img.onload = () => {
      g.drawImage(img, cx, cy, cw, ch, 0, 0, cw, ch)
      props.onApply(canvas.toDataURL('image/png'))
      props.onClose()
    }
    img.src = props.src
  }

  return (
    <div className="tm-backdrop" onClick={props.onClose}>
      <div className="tm imgedit" onClick={(e) => e.stopPropagation()}>
        <div className="tm-head">
          <h2>裁剪工具</h2>
          <button className="tm-x" onClick={props.onClose} title="关闭">
            ✕
          </button>
        </div>
        <div className="imgedit-bar">
          {RATIOS.map((r, i) => (
            <button key={r.label} className={'imgedit-chip' + (i === ratioIdx ? ' on' : '')} onClick={() => applyRatio(i)}>
              {r.label}
            </button>
          ))}
        </div>
        <div className="imgedit-stage" style={{ width: STAGE_W, height: STAGE_H }} onPointerDown={(e) => e.stopPropagation()}>
          <img src={props.src} className="imgedit-img" draggable={false} alt="" />
          {natural && (
            <div
              className="crop-rect"
              style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
              onPointerDown={(e) => onDown(e, 'move')}
            >
              <span className="crop-handle br" onPointerDown={(e) => onDown(e, 'br')} />
            </div>
          )}
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
