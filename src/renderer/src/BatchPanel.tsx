import { useState } from 'react'
import { prettifyModel } from './genNode'

const SIZES = [
  { label: '1:1', size: '1024x1024' },
  { label: '横 3:2', size: '1536x1024' },
  { label: '竖 2:3', size: '1024x1536' },
  { label: '自动', size: 'auto' }
]

const TYPE_ORDER = ['场景', '人物', '道具']

// 内置提取提示词：剧本 → 场景/人物/道具 + 各自文生图提示词（JSON）
const EXTRACT_PROMPT = (script: string, custom: string): string =>
  '你是专业的影视/游戏概念设计助手。阅读下面的剧本/故事，提取需要绘制概念图的元素，分三类：\n' +
  '- 场景：重要的环境、地点\n' +
  '- 人物：所有出场角色（主角配角都要）\n' +
  '- 道具：关键物件、装备、载具\n' +
  '为每个元素写一段高质量的「文生图」提示词，详细描述外观、材质、光影、氛围与画面风格，便于 AI 出概念图。\n' +
  (custom.trim() ? '额外要求（务必遵守）：' + custom.trim() + '\n' : '') +
  '严格只返回一个 JSON 数组，每项形如 {"type":"场景|人物|道具","name":"名称","prompt":"文生图提示词"}。不要任何解释、不要 markdown 代码块。\n' +
  '剧本：\n"""\n' +
  script +
  '\n"""'

interface Item {
  type: string
  name: string
  prompt: string
  status: 'idle' | 'loading' | 'done' | 'error'
}

function parseItems(text: string): { type: string; name: string; prompt: string }[] {
  let t = text
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim()
  const m = t.match(/\[[\s\S]*\]/)
  if (m) t = m[0]
  try {
    const arr = JSON.parse(t)
    if (Array.isArray(arr))
      return arr
        .filter((x) => x && x.prompt)
        .map((x) => ({
          type: TYPE_ORDER.includes(String(x.type)) ? String(x.type) : '人物',
          name: String(x.name || '未命名'),
          prompt: String(x.prompt)
        }))
  } catch {
    /* ignore */
  }
  return []
}

export function BatchPanel(props: {
  settings: { baseURL: string; apiKey: string; model: string; size: string }
  imageModels: string[]
  textModels: string[]
  onClose: () => void
  startBatch: (script: string) => string | null
  placeNode: (scriptId: string, prompt: string, src: string, index: number) => void
}): JSX.Element {
  const [script, setScript] = useState('')
  const [custom, setCustom] = useState('')
  const [chatModel, setChatModel] = useState(
    () =>
      props.textModels.find((m) => /gemini.*flash|gpt|deepseek|claude|qwen/i.test(m)) ||
      props.textModels[0] ||
      ''
  )
  const [imgModel, setImgModel] = useState(props.settings.model)
  const [size, setSize] = useState(props.settings.size === 'auto' ? '1024x1024' : props.settings.size)
  const [items, setItems] = useState<Item[]>([])
  const [extracting, setExtracting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [genAt, setGenAt] = useState(0)
  const [err, setErr] = useState('')

  const setItem = (i: number, patch: Partial<Item>): void =>
    setItems((xs) => xs.map((c, idx) => (idx === i ? { ...c, ...patch } : c)))

  async function extract(): Promise<void> {
    if (!props.settings.apiKey) {
      setErr('请先在 ⚙ 设置里填入 API 令牌')
      return
    }
    if (!script.trim()) {
      setErr('请先粘贴剧本')
      return
    }
    setExtracting(true)
    setErr('')
    try {
      const text = await window.api.textGenerate({
        baseURL: props.settings.baseURL,
        apiKey: props.settings.apiKey,
        model: chatModel,
        prompt: EXTRACT_PROMPT(script, custom)
      })
      const parsed = parseItems(text)
      if (!parsed.length) throw new Error('没解析出元素，换个对话模型再试。返回片段：' + text.slice(0, 160))
      parsed.sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type))
      setItems(parsed.map((c) => ({ ...c, status: 'idle' as const })))
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setExtracting(false)
    }
  }

  async function generateAll(): Promise<void> {
    if (!items.length) return
    const scriptId = props.startBatch(script)
    if (!scriptId) {
      setErr('画布未就绪')
      return
    }
    setBusy(true)
    setErr('')
    for (let i = 0; i < items.length; i++) {
      setGenAt(i)
      setItem(i, { status: 'loading' })
      try {
        let src = ''
        if (/gemini|banana/i.test(imgModel)) {
          const r = await window.api.imageChat({
            baseURL: props.settings.baseURL,
            apiKey: props.settings.apiKey,
            model: imgModel,
            prompt: items[i].prompt,
            images: []
          })
          src = r.b64 ? `data:image/png;base64,${r.b64}` : r.url || ''
        } else {
          const res = await window.api.generateImage({
            baseURL: props.settings.baseURL,
            apiKey: props.settings.apiKey,
            model: imgModel,
            prompt: items[i].prompt,
            size,
            n: 1
          })
          src = res[0]?.b64 ? `data:image/png;base64,${res[0].b64}` : res[0]?.url || ''
        }
        if (!src) throw new Error('no image')
        props.placeNode(scriptId, items[i].prompt, src, i)
        setItem(i, { status: 'done' })
      } catch {
        setItem(i, { status: 'error' })
      }
    }
    setBusy(false)
  }

  const doneCount = items.filter((c) => c.status === 'done').length
  const chatOptions = props.textModels.includes(chatModel) ? props.textModels : [chatModel, ...props.textModels]
  const imgOptions = props.imageModels.includes(imgModel) ? props.imageModels : [imgModel, ...props.imageModels]

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : props.onClose}>
      <div className="batch-modal" onClick={(e) => e.stopPropagation()}>
        <div className="batch-head">
          <span className="gp-htitle">
            <span className="cm-ico">⚡</span> 剧本批量生成
          </span>
          <button className="gp-x" onClick={props.onClose}>
            ×
          </button>
        </div>

        <textarea
          className="batch-script"
          placeholder="把剧本 / 故事粘贴到这里，我会提取所有场景、人物、道具，并为每项写好文生图提示词…"
          value={script}
          onChange={(e) => setScript(e.target.value)}
        />

        <input
          className="batch-custom"
          placeholder="自定义要求（可选）：如「统一日系动漫画风、全身立绘、白色背景」"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
        />

        <div className="batch-models">
          <label className="field">
            <span>提取模型（对话）</span>
            <select value={chatModel} onChange={(e) => setChatModel(e.target.value)}>
              {chatOptions.length ? (
                chatOptions.map((m) => (
                  <option key={m} value={m}>
                    {prettifyModel(m)}
                  </option>
                ))
              ) : (
                <option value="">（去设置拉取模型）</option>
              )}
            </select>
          </label>
          <label className="field">
            <span>出图模型</span>
            <select value={imgModel} onChange={(e) => setImgModel(e.target.value)}>
              {imgOptions.map((m) => (
                <option key={m} value={m}>
                  {prettifyModel(m)}
                </option>
              ))}
            </select>
          </label>
          <label className="field batch-ratio">
            <span>比例</span>
            <select value={size} onChange={(e) => setSize(e.target.value)}>
              {SIZES.map((s) => (
                <option key={s.size} value={s.size}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <button className="primary wide" onClick={extract} disabled={extracting || busy}>
          {extracting ? '提取中…' : '① 从剧本提取（场景 / 人物 / 道具）'}
        </button>

        {items.length > 0 && (
          <>
            <div className="batch-list">
              {items.map((c, i) => (
                <div className={'batch-char s-' + c.status} key={i}>
                  <span
                    className={
                      'batch-type t-' + (c.type === '场景' ? 'scene' : c.type === '道具' ? 'prop' : 'char')
                    }
                  >
                    {c.type}
                  </span>
                  <input
                    className="batch-name"
                    value={c.name}
                    onChange={(e) => setItem(i, { name: e.target.value })}
                  />
                  <textarea
                    className="batch-cprompt"
                    rows={2}
                    value={c.prompt}
                    onChange={(e) => setItem(i, { prompt: e.target.value })}
                  />
                  <span className="batch-st">
                    {c.status === 'loading'
                      ? '⏳'
                      : c.status === 'done'
                        ? '✓'
                        : c.status === 'error'
                          ? '✕'
                          : ''}
                  </span>
                  <button
                    className="batch-del"
                    onClick={() => setItems((xs) => xs.filter((_, idx) => idx !== i))}
                    title="移除"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <button
              className="batch-add"
              onClick={() => setItems((xs) => [...xs, { type: '人物', name: '新元素', prompt: '', status: 'idle' }])}
            >
              ＋ 添加一项
            </button>
            <button className="primary wide" onClick={generateAll} disabled={busy}>
              {busy
                ? `批量生成中… ${genAt + 1}/${items.length}`
                : `② 批量生成 ${items.length} 张（已完成 ${doneCount}）`}
            </button>
          </>
        )}

        {err && <div className="gp-err">{err}</div>}
      </div>
    </div>
  )
}
