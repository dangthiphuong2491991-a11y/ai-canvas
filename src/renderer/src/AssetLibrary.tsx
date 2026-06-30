import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import {
  type Asset,
  type AssetKind,
  ASSET_KINDS,
  listAssets,
  putAsset,
  deleteAsset,
  newAssetId,
  loadShows,
  saveShows,
  mediaKind
} from './assets'

// 素材库：按「剧」分组，每剧下分 人物/场景/道具。
// onInsert 存在（画布打开）→ 点素材插入画布；onPick 存在（节点「素材库」按钮）→ 勾选多张确认后回传给节点。
export function AssetLibrary(props: {
  onClose: () => void
  onInsert?: (a: Asset) => void
  onPick?: (srcs: string[]) => void
}): JSX.Element {
  const [shows, setShows] = useState<string[]>(() => loadShows())
  const [activeShow, setActiveShow] = useState<string>(() => loadShows()[0] || '')
  const [kind, setKind] = useState<AssetKind>('人物')
  const [assets, setAssets] = useState<Asset[]>([])
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)
  const [newShow, setNewShow] = useState('')
  const [picked, setPicked] = useState<Record<string, string>>({}) // id -> src（多选，无上限）
  const fileRef = useRef<HTMLInputElement | null>(null)
  const pickMode = !!props.onPick
  const togglePick = (a: Asset): void =>
    setPicked((prev) => {
      const next = { ...prev }
      if (next[a.id]) delete next[a.id]
      else next[a.id] = a.src
      return next
    })
  const pickedCount = Object.keys(picked).length
  const confirmPick = (): void => {
    const srcs = Object.values(picked)
    if (srcs.length) props.onPick?.(srcs)
  }

  const reload = async (): Promise<void> => {
    setAssets(await listAssets())
  }
  useEffect(() => {
    reload()
  }, [])

  const persistShows = (list: string[]): void => {
    setShows(list)
    saveShows(list)
  }

  const addShow = (): void => {
    const name = newShow.trim()
    if (!name || shows.includes(name)) {
      setAdding(false)
      setNewShow('')
      return
    }
    persistShows([...shows, name])
    setActiveShow(name)
    setAdding(false)
    setNewShow('')
  }

  const delShow = async (): Promise<void> => {
    if (!activeShow) return
    if (!window.confirm(`删除剧「${activeShow}」及其全部素材？不可恢复`)) return
    const toDel = assets.filter((a) => a.show === activeShow)
    for (const a of toDel) await deleteAsset(a.id)
    const rest = shows.filter((s) => s !== activeShow)
    persistShows(rest)
    setActiveShow(rest[0] || '')
    await reload()
  }

  const onPickFiles = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length || !activeShow) return
    const wantPrefix = kind === '音频' ? 'audio/' : kind === '视频' ? 'video/' : 'image/'
    setBusy(true)
    try {
      for (const f of files) {
        if (!f.type.startsWith(wantPrefix)) continue
        const src = await new Promise<string>((res) => {
          const fr = new FileReader()
          fr.onload = () => res(fr.result as string)
          fr.readAsDataURL(f)
        })
        await putAsset({
          id: newAssetId(),
          show: activeShow,
          kind,
          name: f.name.replace(/\.[^.]+$/, ''),
          src,
          createdAt: Date.now()
        })
      }
      await reload()
    } finally {
      setBusy(false)
    }
  }

  const renameAsset = async (id: string, name: string): Promise<void> => {
    const a = assets.find((x) => x.id === id)
    if (!a || a.name === name) return
    await putAsset({ ...a, name: name.trim() || a.name })
    await reload()
  }

  const removeAsset = async (id: string): Promise<void> => {
    await deleteAsset(id)
    await reload()
  }

  const shown = assets.filter((a) => a.show === activeShow && a.kind === kind)
  const countOf = (k: AssetKind): number => assets.filter((a) => a.show === activeShow && a.kind === k).length

  return (
    <div className="tm-backdrop" onClick={props.onClose}>
      <div className="tm al" onClick={(e) => e.stopPropagation()}>
        <div className="tm-head">
          <h2>
            📦 素材库
            {pickMode ? (
              <span className="al-hint">勾选素材可多选，点下方「添加到节点」</span>
            ) : (
              props.onInsert && <span className="al-hint">点素材即可插入画布</span>
            )}
          </h2>
          <button className="tm-x" onClick={props.onClose} title="关闭">
            ✕
          </button>
        </div>

        <div className="tm-body">
          {/* 左：剧列表 */}
          <div className="tm-list">
            <div className="tm-list-head">
              <span className="tm-list-title">剧</span>
              <button className="tm-new" onClick={() => setAdding(true)}>
                新建剧
              </button>
              <button className="tm-del" onClick={delShow} disabled={!activeShow}>
                删除
              </button>
            </div>
            {adding && (
              <div className="al-addrow">
                <input
                  autoFocus
                  value={newShow}
                  placeholder="剧名…"
                  onChange={(e) => setNewShow(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') addShow()
                    if (e.key === 'Escape') {
                      setAdding(false)
                      setNewShow('')
                    }
                  }}
                />
                <button onClick={addShow}>✓</button>
              </div>
            )}
            <div className="tm-list-scroll">
              {shows.length === 0 && <div className="tm-empty">还没有剧，点「新建剧」创建一个</div>}
              {shows.map((s) => {
                const n = assets.filter((a) => a.show === s).length
                return (
                  <button
                    key={s}
                    className={'tm-item' + (s === activeShow ? ' on' : '')}
                    onClick={() => setActiveShow(s)}
                  >
                    <span className="al-show-ico">🎬</span>
                    <span className="tm-iname">{s}</span>
                    {n > 0 && <span className="al-show-n">{n}</span>}
                  </button>
                )
              })}
            </div>
          </div>

          {/* 右：素材区 */}
          <div className="al-main">
            {!activeShow ? (
              <div className="tm-editor-empty">先在左侧「新建剧」，再上传 人物 / 场景 / 道具 素材</div>
            ) : (
              <>
                <div className="al-tabs">
                  {ASSET_KINDS.map((k) => (
                    <button key={k} className={'al-tab' + (k === kind ? ' on' : '')} onClick={() => setKind(k)}>
                      {k}
                      <span className="al-tab-n">{countOf(k)}</span>
                    </button>
                  ))}
                  <button className="al-upload" onClick={() => fileRef.current?.click()} disabled={busy}>
                    {busy ? '上传中…' : '＋ 上传' + kind}
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept={kind === '音频' ? 'audio/*' : kind === '视频' ? 'video/*' : 'image/*'}
                    multiple
                    hidden
                    onChange={onPickFiles}
                  />
                </div>

                {shown.length === 0 ? (
                  <div className="al-empty">「{activeShow}」暂无{kind}素材，点右上「＋ 上传{kind}」</div>
                ) : (
                  <div className="al-grid">
                    {shown.map((a) => {
                      const on = !!picked[a.id]
                      return (
                        <div
                          key={a.id}
                          className={
                            'al-card' +
                            (props.onInsert || pickMode ? ' al-clickable' : '') +
                            (on ? ' al-picked' : '')
                          }
                          onClick={() => (pickMode ? togglePick(a) : props.onInsert?.(a))}
                          title={pickMode ? '点击选择 / 取消' : props.onInsert ? '点击插入画布' : a.name}
                        >
                          <div className="al-thumb">
                            {mediaKind(a.src) === 'audio' ? (
                              <div className="al-audio">
                                <span className="al-audio-ico">🎵</span>
                                <audio
                                  src={a.src}
                                  controls
                                  onClick={(e) => e.stopPropagation()}
                                  onPointerDown={(e) => e.stopPropagation()}
                                />
                              </div>
                            ) : mediaKind(a.src) === 'video' ? (
                              <video
                                src={a.src}
                                muted
                                onClick={(e) => e.stopPropagation()}
                                onPointerDown={(e) => e.stopPropagation()}
                              />
                            ) : (
                              <img src={a.src} alt={a.name} draggable={false} />
                            )}
                            {pickMode ? (
                              <span className={'al-check' + (on ? ' on' : '')}>{on ? '✓' : ''}</span>
                            ) : (
                              props.onInsert && <span className="al-insert">插入画布</span>
                            )}
                          </div>
                          <input
                            className="al-name al-name-edit"
                            defaultValue={a.name}
                            title="点击可改名"
                            onClick={(e) => e.stopPropagation()}
                            onPointerDown={(e) => e.stopPropagation()}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                            }}
                            onBlur={(e) => renameAsset(a.id, e.target.value)}
                          />
                          <button
                            className="al-del"
                            title="删除素材"
                            onClick={(e) => {
                              e.stopPropagation()
                              removeAsset(a.id)
                            }}
                          >
                            ×
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {pickMode && (
          <div className="al-footer">
            <span className="al-foot-n">已选 {pickedCount} 张</span>
            <button className="al-foot-clear" onClick={() => setPicked({})} disabled={!pickedCount}>
              清空
            </button>
            <button className="primary al-foot-add" onClick={confirmPick} disabled={!pickedCount}>
              添加到节点{pickedCount ? `（${pickedCount}）` : ''}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
