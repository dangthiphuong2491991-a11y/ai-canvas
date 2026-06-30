import React, { useEffect, useState, type CSSProperties } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { Activation } from './Activation'
import './styles.css'
import { installBrowserApiFallback } from './browserApi'

// 纯浏览器打开 dev server 时（无 Electron 预加载）装上直连回退，桌面端不生效
installBrowserApiFallback()

// 启动门：未激活 → 显示激活界面；已激活（或纯浏览器 dev，无激活接口）→ 进入画布
function Gate(): JSX.Element {
  const [state, setState] = useState<'loading' | 'locked' | 'ok'>('loading')
  useEffect(() => {
    if (!window.api?.license) {
      setState('ok') // 浏览器 dev 无 preload，直接放行
      return
    }
    window.api.license
      .status()
      .then((s) => setState(s.activated ? 'ok' : 'locked'))
      .catch(() => setState('ok'))
  }, [])

  if (state === 'loading') return <div style={boot}>加载中…</div>
  if (state === 'locked') return <Activation onActivated={() => setState('ok')} />
  return (
    <>
      <UpdateNotice />
      <App />
    </>
  )
}

// 自动更新提示条（右下角）
function UpdateNotice(): JSX.Element | null {
  const [phase, setPhase] = useState<'available' | 'progress' | 'downloaded' | null>(null)
  const [pct, setPct] = useState(0)
  useEffect(() => {
    if (!window.api?.update) return
    return window.api.update.on(({ type, data }) => {
      if (type === 'available') setPhase('available')
      else if (type === 'progress') {
        setPhase('progress')
        setPct(Number(data) || 0)
      } else if (type === 'downloaded') setPhase('downloaded')
    })
  }, [])
  if (!phase) return null
  return (
    <div style={toast}>
      {phase === 'available' && '发现新版本，正在后台下载…'}
      {phase === 'progress' && `下载更新中 ${pct}%`}
      {phase === 'downloaded' && (
        <>
          新版本已就绪{' '}
          <button style={toastBtn} onClick={() => window.api!.update!.install()}>
            重启更新
          </button>
        </>
      )}
    </div>
  )
}

const boot: CSSProperties = {
  position: 'fixed',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#0e0e10',
  color: '#888',
  fontFamily: 'Inter, system-ui, sans-serif',
  fontSize: 14
}
const toast: CSSProperties = {
  position: 'fixed',
  right: 18,
  bottom: 18,
  zIndex: 9999,
  background: '#1d1d20',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 12,
  padding: '11px 15px',
  color: '#eee',
  fontSize: 13,
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  boxShadow: '0 12px 36px rgba(0,0,0,0.5)'
}
const toastBtn: CSSProperties = {
  border: 'none',
  borderRadius: 8,
  background: '#fff',
  color: '#111',
  fontSize: 12.5,
  fontWeight: 600,
  padding: '6px 12px',
  cursor: 'pointer'
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Gate />
  </React.StrictMode>
)
