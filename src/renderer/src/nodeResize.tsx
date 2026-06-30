import type { Editor, TLShapeId } from 'tldraw'

// 节点右下角缩放手柄：拖动直接改 w/h（绕过 tldraw 选中，编辑框节点也能放大/缩小）
export function ResizeHandle({
  editor,
  shapeId,
  minW = 120,
  minH = 80
}: {
  editor: Editor
  shapeId: TLShapeId
  minW?: number
  minH?: number
}): JSX.Element {
  const onDown = (e: React.PointerEvent): void => {
    e.stopPropagation()
    e.preventDefault()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sh = editor.getShape(shapeId) as any
    if (!sh) return
    const type = sh.type as string
    const startW = sh.props.w as number
    const startH = sh.props.h as number
    const sx = e.clientX
    const sy = e.clientY
    const z = Math.max(0.05, editor.getZoomLevel())
    const move = (ev: PointerEvent): void => {
      const w = Math.max(minW, Math.round(startW + (ev.clientX - sx) / z))
      const h = Math.max(minH, Math.round(startH + (ev.clientY - sy) / z))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      editor.updateShape({ id: shapeId, type, props: { w, h } } as any)
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  return <div className="node-resize" onPointerDown={onDown} title="拖动放大 / 缩小" />
}
