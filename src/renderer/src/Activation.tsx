import { useEffect, useState, type CSSProperties } from 'react'

// 激活界面：未激活时全屏拦截。显示本机机器码（发给作者签发），粘贴激活码激活。
export function Activation({ onActivated }: { onActivated: () => void }): JSX.Element {
  const [machineId, setMachineId] = useState('')
  const [code, setCode] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

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

  const submit = async (): Promise<void> => {
    const c = code.trim()
    if (!c) {
      setMsg('请粘贴激活码')
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
