import { useEffect, useState } from 'react'
import { listUsage, clearUsage, type UsageEntry } from './usageLog'

function fmtTime(ms: number): string {
  if (!ms) return '—'
  const d = new Date(ms)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function fmtDur(ms: number): string {
  if (!ms) return '—'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} 秒`
  return `${Math.floor(s / 60)} 分 ${s % 60} 秒`
}

// 使用日志：模型 / 提交时间 / 生成时间 / 总用时 / 状态
export function UsageLog(props: { onClose: () => void }): JSX.Element {
  const [rows, setRows] = useState<UsageEntry[]>(() => listUsage())
  useEffect(() => {
    const h = (): void => setRows(listUsage())
    window.addEventListener('usagelog-changed', h)
    return () => window.removeEventListener('usagelog-changed', h)
  }, [])

  return (
    <div className="tm-backdrop" onClick={props.onClose}>
      <div className="tm ul" onClick={(e) => e.stopPropagation()}>
        <div className="tm-head">
          <h2>
            📊 使用日志<span className="al-hint">共 {rows.length} 条 · 仅本机记录</span>
          </h2>
          <div className="ul-head-btns">
            <button
              className="tm-new"
              onClick={() => {
                if (window.confirm('清空全部使用日志？')) clearUsage()
              }}
              disabled={!rows.length}
            >
              清空
            </button>
            <button className="tm-x" onClick={props.onClose} title="关闭">
              ✕
            </button>
          </div>
        </div>

        <div className="ul-body">
          {rows.length === 0 ? (
            <div className="tm-empty">还没有生成记录。去画布生成视频后，这里会自动记录。</div>
          ) : (
            <table className="ul-table">
              <thead>
                <tr>
                  <th>模型</th>
                  <th>提交时间</th>
                  <th>生成完成</th>
                  <th>总用时</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <span className="ul-model">{r.model || '—'}</span>
                      {r.kind && r.kind !== 'video' && <span className="ul-kind">{r.kind}</span>}
                    </td>
                    <td>{fmtTime(r.submittedAt)}</td>
                    <td>{fmtTime(r.finishedAt)}</td>
                    <td>{fmtDur(r.totalMs)}</td>
                    <td>
                      <span className={'ul-status ' + (r.status === 'success' ? 'ok' : 'err')}>
                        {r.status === 'success' ? '成功' : '失败'}
                      </span>
                      {r.status === 'error' && r.error && <span className="ul-err" title={r.error}>{r.error}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
