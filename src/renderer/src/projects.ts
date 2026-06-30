// 多项目管理（每个项目 = 一块独立画布，tldraw persistenceKey 隔离）
// kind: 'canvas' 普通创作画布；'reroll' 转绘工作流（视频反推 → 图片生成 → 视频生成）
export type ProjectKind = 'canvas' | 'reroll'
export interface Project {
  id: string
  name: string
  kind?: ProjectKind
  createdAt: number
  updatedAt: number
}

const KEY = 'ai-canvas-projects'

export function loadProjects(): Project[] {
  try {
    const a = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(a) ? a : []
  } catch {
    return []
  }
}

export function saveProjects(list: Project[]): void {
  localStorage.setItem(KEY, JSON.stringify(list))
}

export function newId(): string {
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

// 'default' 复用旧的单画布 key，保留用户已有内容
export function persistKey(id: string): string {
  return id === 'default' ? 'ai-canvas' : `ai-canvas-${id}`
}

export function relativeTime(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (s < 60) return '几秒前'
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`
  return `${Math.floor(s / 86400)} 天前`
}

// 由 id 派生稳定渐变作为缩略图占位
export function gradientFor(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  const a = h % 360
  const b = (a + 70 + (h % 110)) % 360
  return `linear-gradient(135deg, hsl(${a} 52% 42%), hsl(${b} 50% 26%))`
}
