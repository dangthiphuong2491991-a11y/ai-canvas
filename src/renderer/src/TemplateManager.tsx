import { useRef, useState } from 'react'
import {
  type PromptTemplate,
  type TemplateCategory,
  TEMPLATE_CATEGORIES,
  TEMPLATE_VARS,
  DEFAULT_MARKERS,
  newTemplateId
} from './promptConfig'

// 对标字字动画「提示词模板」编辑器：顶部分类 Tab + 左边模板列表（官方/用户徽标 + 新建/删除）+ 右边大编辑器
export function TemplateManager(props: {
  templates: PromptTemplate[]
  textModels: string[]
  onChange: (templates: PromptTemplate[]) => void
  onClose: () => void
}): JSX.Element {
  const [activeCat, setActiveCat] = useState<TemplateCategory>(
    () => props.templates[0]?.category || '综合提取'
  )
  const [editId, setEditId] = useState(props.templates[0]?.id || '')
  const contentRef = useRef<HTMLTextAreaElement>(null)

  const inCat = props.templates.filter((t) => t.category === activeCat)
  const tpl = inCat.find((t) => t.id === editId) || inCat[0]

  const updateTpl = (patch: Partial<PromptTemplate>): void => {
    if (!tpl) return
    props.onChange(props.templates.map((t) => (t.id === tpl.id ? { ...t, ...patch } : t)))
  }

  const switchCat = (cat: TemplateCategory): void => {
    setActiveCat(cat)
    const first = props.templates.find((t) => t.category === cat)
    setEditId(first?.id || '')
  }

  const addTpl = (): void => {
    const id = newTemplateId()
    const t: PromptTemplate = {
      id,
      name: '新模板 ' + (inCat.length + 1),
      source: 'user',
      category: activeCat,
      modelPlatform: '默认',
      model: '默认',
      contentSep: DEFAULT_MARKERS.contentSep,
      recordSep: DEFAULT_MARKERS.recordSep,
      outputStart: activeCat === '综合提取' || activeCat === '分镜推理' ? DEFAULT_MARKERS.outputStart : '',
      outputEnd: activeCat === '综合提取' || activeCat === '分镜推理' ? DEFAULT_MARKERS.outputEnd : '',
      content: ''
    }
    props.onChange([...props.templates, t])
    setEditId(id)
  }

  const dupTpl = (): void => {
    if (!tpl) return
    const id = newTemplateId()
    props.onChange([...props.templates, { ...tpl, id, name: tpl.name + ' 副本', source: 'user' }])
    setEditId(id)
  }

  const delTpl = (): void => {
    if (!tpl || props.templates.length <= 1) return
    const rest = props.templates.filter((t) => t.id !== tpl.id)
    props.onChange(rest)
    setEditId(rest.find((t) => t.category === activeCat)?.id || '')
  }

  // 把 {{变量}} 插到正文光标处
  const insertVar = (v: string): void => {
    if (!tpl) return
    const ta = contentRef.current
    const token = '{{' + v + '}}'
    if (!ta) {
      updateTpl({ content: tpl.content + token })
      return
    }
    const start = ta.selectionStart ?? tpl.content.length
    const end = ta.selectionEnd ?? tpl.content.length
    const next = tpl.content.slice(0, start) + token + tpl.content.slice(end)
    updateTpl({ content: next })
    requestAnimationFrame(() => {
      ta.focus()
      const pos = start + token.length
      ta.setSelectionRange(pos, pos)
    })
  }

  const catCount = (cat: TemplateCategory): number => props.templates.filter((t) => t.category === cat).length

  return (
    <div className="tm-backdrop" onClick={props.onClose}>
      <div className="tm" onClick={(e) => e.stopPropagation()}>
        <div className="tm-head">
          <h2>提示词模板</h2>
          <button className="tm-x" onClick={props.onClose} title="关闭">
            ✕
          </button>
        </div>

        {/* 分类 Tab */}
        <div className="tm-tabs">
          {TEMPLATE_CATEGORIES.map((cat) => (
            <button
              key={cat}
              className={'tm-tab' + (cat === activeCat ? ' on' : '')}
              onClick={() => switchCat(cat)}
            >
              {cat}
              <span className="tm-tab-n">{catCount(cat)}</span>
            </button>
          ))}
        </div>

        <div className="tm-body">
          {/* 左：模板列表 */}
          <div className="tm-list">
            <div className="tm-list-head">
              <span className="tm-list-title">模板列表</span>
              <button className="tm-new" onClick={addTpl}>
                新建
              </button>
              <button className="tm-del" onClick={delTpl} disabled={!tpl || props.templates.length <= 1}>
                删除
              </button>
            </div>
            <div className="tm-list-scroll">
              {inCat.length === 0 && <div className="tm-empty">该分类暂无模板，点「新建」创建一个</div>}
              {inCat.map((t) => (
                <button
                  key={t.id}
                  className={'tm-item' + (tpl && t.id === tpl.id ? ' on' : '')}
                  onClick={() => setEditId(t.id)}
                >
                  <span className={'tm-badge ' + (t.source === 'official' ? 'official' : 'user')}>
                    {t.source === 'official' ? '官方' : '用户'}
                  </span>
                  <span className="tm-iname">{t.name || '未命名'}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 右：编辑器 */}
          {tpl ? (
            <div className="tm-editor">
              <div className="tm-field">
                <label>模板名称</label>
                <div className="tm-name-row">
                  <input value={tpl.name} onChange={(e) => updateTpl({ name: e.target.value })} />
                  <button className="tm-dup" onClick={dupTpl} title="复制为新模板">
                    ⧉ 复制
                  </button>
                </div>
              </div>

              <div className="tm-row2">
                <div className="tm-field">
                  <label>模型平台</label>
                  <input
                    value={tpl.modelPlatform}
                    onChange={(e) => updateTpl({ modelPlatform: e.target.value })}
                    placeholder="默认"
                  />
                </div>
                <div className="tm-field">
                  <label>模型选择</label>
                  <select value={tpl.model} onChange={(e) => updateTpl({ model: e.target.value })}>
                    <option value="默认">默认（用节点选的模型）</option>
                    {!props.textModels.includes(tpl.model) && tpl.model !== '默认' && (
                      <option value={tpl.model}>{tpl.model}</option>
                    )}
                    {props.textModels.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="tm-row2">
                <div className="tm-field">
                  <label>内容分隔符</label>
                  <input value={tpl.contentSep} onChange={(e) => updateTpl({ contentSep: e.target.value })} />
                </div>
                <div className="tm-field">
                  <label>记录分隔符</label>
                  <input value={tpl.recordSep} onChange={(e) => updateTpl({ recordSep: e.target.value })} />
                </div>
              </div>

              <div className="tm-row2">
                <div className="tm-field">
                  <label>输出开始符</label>
                  <input value={tpl.outputStart} onChange={(e) => updateTpl({ outputStart: e.target.value })} />
                </div>
                <div className="tm-field">
                  <label>输出结束符</label>
                  <input value={tpl.outputEnd} onChange={(e) => updateTpl({ outputEnd: e.target.value })} />
                </div>
              </div>

              <div className="tm-field">
                <label>变量状态（点击插入到正文）</label>
                <div className="tm-vars">
                  {TEMPLATE_VARS.map((v) => {
                    const used = tpl.content.includes('{{' + v + '}}')
                    return (
                      <button
                        key={v}
                        className={'tm-var' + (used ? ' used' : '')}
                        onClick={() => insertVar(v)}
                        title={used ? '已使用，点击再次插入' : '点击插入'}
                      >
                        {'{{' + v + '}}'}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="tm-field tm-content">
                <label>内容</label>
                <textarea
                  ref={contentRef}
                  value={tpl.content}
                  onChange={(e) => updateTpl({ content: e.target.value })}
                  placeholder="在这里写提示词正文，用 {{小说原文}} / {{故事情节}} 等变量占位，运行时会替换成你粘贴的剧本…"
                  spellCheck={false}
                />
              </div>

              <div className="tm-hint">
                {tpl.category === '角色提取' || tpl.category === '场景提取' || tpl.category === '物品提取' ? (
                  <>
                    本分类约定输出 <code>JSON 数组</code>，每项含 <code>name</code> 与 <code>description</code>（
                    description 即出图提示词），运行时按「{tpl.category.replace('提取', '')}」类型并入元素列表。
                  </>
                ) : (
                  <>
                    本分类一次性输出全部元素：用「输出开始 / 结束符」包裹，记录间用 <code>{tpl.recordSep}</code>、字段间用{' '}
                    <code>{tpl.contentSep}</code> 分隔（类型 / 名称 / 提示词）。变量 <code>{'{{故事情节}}'}</code> 会替换为粘贴的剧本。
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="tm-editor tm-editor-empty">选择左侧模板，或点「新建」创建一个「{activeCat}」模板</div>
          )}
        </div>
      </div>
    </div>
  )
}
