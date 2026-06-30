import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties } from 'react'

// 激活界面：未激活时全屏拦截。显示本机机器码（发给作者签发），粘贴 / 导入 txt 激活码激活。
export function Activation({ onActivated }: { onActivated: () => void }): JSX.Element {
  const [machineId, setMachineId] = useState('')
  const [code, setCode] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    window.api?.license
      ?.status()
      .then((s) => {
        setMachineId(s.machineId)
        if (s.reason) setMsg(s.reason)
      })
      .catch(() => {})
  }, [])

  const copyMid = (): void => {
    navigator.clipboard?.writeText(machineId).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      },
      () => {}
    )
  }

  const doActivate = async (c: string): Promise<void> => {
    if (!c) {
      setMsg('请粘贴激活码，或导入激活码 txt 文件')
      return
    }
    setBusy(true)
    setMsg('')
    try {
      const r = await window.api!.license!.activate(c)
      if (r.ok) {
        onActivated()
        return
      }
      setMsg(r.reason || '激活失败')
    } catch {
      setMsg('激活失败')
    } finally {
      setBusy(false)
    }
  }

  const submit = (): Promise<void> => doActivate(code.trim())

  // 导入作者发来的激活码 txt（从文件里自动提取那一长串激活码，免手动复制粘贴出错）
  const onImportTxt = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    try {
      const text = await f.text()
      const m = text.match(/[A-Za-z0-9_-]{40,}\.[A-Za-z0-9_-]{40,}/)
      if (!m) {
        setMsg('这个 txt 里没找到激活码，请确认选的是作者发来的激活码文件')
        return
      }
      setCode(m[0])
      await doActivate(m[0])
    } catch {
      setMsg('读取 txt 文件失败')
    }
  }

  return (
    <div style={wrap}>
      <div style={card}>
        <div style={brand}>✨ AI 画布</div>
        <h1 style={h1}>激活软件</h1>
        <p style={hint}>把下面的「机器码」发给作者获取激活码。激活码与本机绑定，只能在这台电脑使用。</p>

        <div style={label}>本机机器码</div>
        <div style={row}>
          <code style={midBox}>{machineId || '读取中…'}</code>
          <button style={btnGhost} onClick={copyMid} disabled={!machineId}>
            {copied ? '已复制' : '复制'}
          </button>
        </div>

        <div style={{ ...label, marginTop: 18 }}>激活码</div>
        <textarea
          style={ta}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="粘贴作者发给你的激活码…"
          spellCheck={false}
        />

        {msg && <div style={err}>{msg}</div>}

        <button style={{ ...btnPrimary, opacity: busy ? 0.6 : 1 }} onClick={submit} disabled={busy}>
          {busy ? '激活中…' : '激活'}
        </button>

        <input ref={fileRef} type="file" accept=".txt" hidden onChange={onImportTxt} />
        <button style={{ ...btnImport, opacity: busy ? 0.6 : 1 }} onClick={() => fileRef.current?.click()} disabled={busy}>
          📄 导入激活码 txt 文件（免复制，防出错）
        </button>
      </div>
    </div>
  )
}

const wrap: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: '#0e0e10',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#fafafa',
  fontFamily: 'Inter, system-ui, sans-serif'
}
const card: CSSProperties = {
  width: 460,
  maxWidth: '90vw',
  background: '#1a1a1e',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 18,
  padding: '30px 32px 34px',
  boxShadow: '0 20px 60px rgba(0,0,0,0.55)'
}
const brand: CSSProperties = { fontSize: 13, color: '#a1a1a1', marginBottom: 14 }
const h1: CSSProperties = { fontSize: 22, fontWeight: 600, margin: '0 0 8px' }
const hint: CSSProperties = { fontSize: 13, color: '#9a9a9a', lineHeight: 1.7, margin: '0 0 22px' }
const label: CSSProperties = { fontSize: 12, color: '#a1a1a1', marginBottom: 8 }
const row: CSSProperties = { display: 'flex', gap: 8, alignItems: 'stretch' }
const midBox: CSSProperties = {
  flex: 1,
  fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
  fontSize: 14,
  letterSpacing: 0.5,
  background: '#0e0e10',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 10,
  padding: '11px 13px',
  color: '#fff',
  userSelect: 'all',
  wordBreak: 'break-all'
}
const ta: CSSProperties = {
  width: '100%',
  minHeight: 90,
  resize: 'vertical',
  background: '#0e0e10',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 10,
  padding: '11px 13px',
  color: '#fff',
  fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
  fontSize: 13,
  lineHeight: 1.5,
  outline: 'none',
  boxSizing: 'border-box'
}
const err: CSSProperties = { color: '#ff8585', fontSize: 12.5, marginTop: 12, lineHeight: 1.6 }
const btnPrimary: CSSProperties = {
  width: '100%',
  marginTop: 20,
  padding: '12px 0',
  border: 'none',
  borderRadius: 10,
  background: '#fff',
  color: '#111',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer'
}
const btnGhost: CSSProperties = {
  padding: '0 16px',
  border: '1px solid rgba(255,255,255,0.14)',
  borderRadius: 10,
  background: 'transparent',
  color: '#eee',
  fontSize: 13,
  cursor: 'pointer'
}
const btnImport: CSSProperties = {
  width: '100%',
  marginTop: 10,
  padding: '11px 0',
  border: '1px solid rgba(255,255,255,0.16)',
  borderRadius: 10,
  background: 'transparent',
  color: '#dcdcdc',
  fontSize: 13.5,
  fontWeight: 500,
  cursor: 'pointer'
}
