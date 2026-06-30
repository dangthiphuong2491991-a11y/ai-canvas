// 视频生成使用日志（localStorage）：模型 / 提交时间 / 生成时间 / 总用时 / 状态
export interface UsageEntry {
  id: string
  kind: string // video / image
  model: string
  submittedAt: number // ms 时间戳
  finishedAt: number // ms 时间戳
  totalMs: number
  status: 'success' | 'error'
  error?: string
}

const KEY = 'ai-canvas-usagelog'
const MAX = 300

export function listUsage(): UsageEntry[] {
  try {
    const a = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(a) ? a : []
  } catch {
    return []
  }
}

export function addUsage(e: UsageEntry): void {
  const list = listUsage()
  list.unshift(e)
  localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)))
  window.dispatchEvent(new Event('usagelog-changed'))
}

export function clearUsage(): void {
  localStorage.removeItem(KEY)
  window.dispatchEvent(new Event('usagelog-changed'))
}

export function newUsageId(): string {
  return 'u_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

// 记录一条：传入提交时间戳与状态，自动算总用时
export function recordUsage(p: {
  kind: string
  model: string
  submittedAt: number
  status: 'success' | 'error'
  error?: string
}): void {
  const finishedAt = Date.now()
  addUsage({
    id: newUsageId(),
    kind: p.kind,
    model: p.model,
    submittedAt: p.submittedAt,
    finishedAt,
    totalMs: Math.max(0, finishedAt - p.submittedAt),
    status: p.status,
    error: p.error
  })
}
