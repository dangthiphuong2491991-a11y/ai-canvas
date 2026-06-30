import { useState } from 'react'
import { type Project, type ProjectKind, relativeTime, gradientFor } from './projects'

type Tab = 'canvas' | 'team'

export function HomePage(props: {
  projects: Project[]
  onOpen: (id: string) => void
  onCreate: (kind: ProjectKind) => void
  onDelete: (id: string) => void
  onOpenSettings: () => void
  onOpenTemplates: () => void
  onOpenAssets: () => void
  onOpenUsage: () => void
}): JSX.Element {
  const [q, setQ] = useState('')
  const [tab, setTab] = useState<Tab>('canvas')

  const kindOf = (p: Project): ProjectKind => p.kind || 'canvas'
  // 个人空间显示全部项目（含以前建的转绘项目）；团队暂无
  const list = props.projects
    .filter(() => tab !== 'team')
    .filter((p) => p.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => b.updatedAt - a.updatedAt)

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'canvas', label: '个人' },
    { id: 'team', label: '团队项目' }
  ]

  return (
    <div className="home">
      <header className="home-top">
        <div className="home-brand">
          <span className="dot" /> AI 画布
        </div>
        <nav className="home-nav">
          <span className="on">工作空间</span>
        </nav>
        <button className="home-tpl" onClick={props.onOpenAssets} title="素材库（人物 / 场景 / 道具，按剧分组）">
          📦 素材库
        </button>
        <button className="home-tpl" onClick={props.onOpenTemplates} title="提示词模板（新建 / 编辑 / 变量）">
          🎨 提示词模板
        </button>
        <button className="home-tpl" onClick={props.onOpenUsage} title="使用日志（模型 / 提交 / 生成 / 用时）">
          📊 使用日志
        </button>
        <button className="home-settings" onClick={props.onOpenSettings} title="全局设置（渠道 / 模型）">
          ⚙ 设置
        </button>
        <div className="home-user" />
      </header>

      <div className="home-body">
        <div className="home-subhead">
          <div className="home-tabs">
            {tabs.map((t) => (
              <span
                key={t.id}
                className={t.id === tab ? 'on' : 'muted'}
                onClick={() => setTab(t.id)}
                role="button"
                tabIndex={0}
              >
                {t.label}
              </span>
            ))}
          </div>
          <div className="home-actions">
            <input
              className="home-search"
              placeholder="搜索项目…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            {tab !== 'team' && (
              <button className="primary" onClick={() => props.onCreate('canvas')}>
                ＋ 新建项目
              </button>
            )}
          </div>
        </div>

        {tab === 'team' ? (
          <div className="home-empty">团队项目即将上线</div>
        ) : (
          <div className="home-grid">
            <button className="card card-new" onClick={() => props.onCreate('canvas')}>
              <span className="card-plus">＋</span>
              <span>新建项目</span>
            </button>

            {list.map((p) => (
              <div
                key={p.id}
                className="card"
                onClick={() => props.onOpen(p.id)}
                role="button"
                tabIndex={0}
              >
                <div className="card-thumb" style={{ background: gradientFor(p.id) }}>
                  {kindOf(p) === 'reroll' && <span className="card-badge">转绘</span>}
                </div>
                <div className="card-meta">
                  <div className="card-name">{p.name || '未命名'}</div>
                  <div className="card-time">编辑于 {relativeTime(p.updatedAt)}</div>
                </div>
                <button
                  className="card-del"
                  title="删除项目"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (window.confirm(`删除项目「${p.name || '未命名'}」？此操作不可恢复`)) props.onDelete(p.id)
                  }}
                >
                  🗑
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
