import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import { stopEventPropagation } from 'tldraw'

// 提示词里 @ 提及一张图片：打 @ 弹出可选图片（已连接 / 已添加），选中插入「@名称」
export interface MentionItem {
  key: string
  name: string
  thumb?: string // 图片缩略图
  icon?: string // 无缩略图时显示的图标（音频🎵 / 视频🎬）
}

// 取光标前最近的 @token（@ 到光标之间无空白即触发，@ 可紧跟在文字后面）→ {start, query}
function activeMention(text: string, caret: number): { start: number; query: string } | null {
  let i = caret - 1
  while (i >= 0) {
    const ch = text[i]
    if (ch === '@') return { start: i, query: text.slice(i + 1, caret) }
    if (/\s/.test(ch)) return null // 遇到空白还没碰到 @ → 不触发
    i--
  }
  return null
}

export function MentionInput(props: {
  value: string
  onChange: (v: string) => void
  onEnter: () => void
  placeholder?: string
  items: MentionItem[]
  className?: string
}): JSX.Element {
  const taRef = useRef<HTMLTextAreaElement | null>(null)
  const [menu, setMenu] = useState<{ start: number; query: string } | null>(null)
  const [hi, setHi] = useState(0)
  const pendingCaret = useRef<number | null>(null)

  // 受控插入后，把光标恢复到指定位置
  useLayoutEffect(() => {
    if (pendingCaret.current != null && taRef.current) {
      taRef.current.selectionStart = taRef.current.selectionEnd = pendingCaret.current
      pendingCaret.current = null
    }
  })

  // 鼠标在编辑框上滚轮 = 滚动文本框本身（手动滚 + 阻止冒泡到 tldraw，否则会缩放/平移画布）
  // 必须用原生 non-passive 监听，React 的 onWheel 是 passive、preventDefault 无效
  useEffect(() => {
    const el = taRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      e.stopPropagation()
      e.preventDefault()
      el.scrollTop += e.deltaY
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const filtered = menu
    ? props.items.filter((it) => it.name.toLowerCase().includes(menu.query.toLowerCase()))
    : []

  const refresh = (text: string, caret: number): void => {
    const m = activeMention(text, caret)
    setMenu(m)
    setHi(0)
  }

  const onChange = (e: ChangeEvent<HTMLTextAreaElement>): void => {
    props.onChange(e.target.value)
    refresh(e.target.value, e.target.selectionStart)
  }

  const pick = (it: MentionItem): void => {
    const ta = taRef.current
    if (!ta || !menu) return
    const caret = ta.selectionStart
    const before = props.value.slice(0, menu.start)
    const after = props.value.slice(caret)
    const insert = `@${it.name} `
    const next = before + insert + after
    pendingCaret.current = (before + insert).length
    props.onChange(next)
    setMenu(null)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (menu && filtered.length) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHi((h) => (h + 1) % filtered.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHi((h) => (h - 1 + filtered.length) % filtered.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        pick(filtered[hi])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setMenu(null)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      props.onEnter()
    }
  }

  return (
    <div className="mi-wrap">
      <textarea
        ref={taRef}
        className={props.className}
        value={props.value}
        placeholder={props.placeholder}
        onChange={onChange}
        onKeyDown={onKeyDown}
        onKeyUp={(e) => refresh((e.target as HTMLTextAreaElement).value, (e.target as HTMLTextAreaElement).selectionStart)}
        onClick={(e) => refresh((e.target as HTMLTextAreaElement).value, (e.target as HTMLTextAreaElement).selectionStart)}
        onBlur={() => setTimeout(() => setMenu(null), 120)}
      />
      {menu && (
        <div className="mi-menu" onPointerDown={stopEventPropagation}>
          {filtered.length === 0 ? (
            <div className="mi-empty">没有可引用的图片（先连一张图或上传 / 选素材）</div>
          ) : (
            filtered.map((it, i) => (
              <button
                key={it.key}
                className={'mi-row' + (i === hi ? ' on' : '')}
                onMouseEnter={() => setHi(i)}
                onMouseDown={(e) => {
                  e.preventDefault()
                  pick(it)
                }}
              >
                {it.thumb ? <img src={it.thumb} alt="" /> : <span className="mi-icon">{it.icon || '📄'}</span>}
                <span className="mi-name">{it.name}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
