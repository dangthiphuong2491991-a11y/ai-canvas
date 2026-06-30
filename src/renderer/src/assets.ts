// 素材库：按「剧（show）」分组，每个剧下分 人物/场景/道具 三类上传图片。
// 图片是 base64 dataURL，体积大，存 IndexedDB（localStorage 装不下）；剧名单独存 localStorage（小、可有空剧）。

export const ASSET_KINDS = ['人物', '场景', '道具', '音频', '视频'] as const
export type AssetKind = (typeof ASSET_KINDS)[number]

export interface Asset {
  id: string
  show: string // 剧名
  kind: AssetKind
  name: string
  src: string // dataURL（图片 / 音频 / 视频）
  createdAt: number
}

// 素材媒体类型判定（按 src 的 dataURL，兼容旧数据）
export function mediaKind(src: string): 'image' | 'audio' | 'video' {
  if (/^data:audio\//i.test(src)) return 'audio'
  if (/^data:video\//i.test(src)) return 'video'
  return 'image'
}

const DB_NAME = 'ai-canvas-assets'
const STORE = 'assets'
const SHOWS_KEY = 'ai-canvas-shows'

let _db: Promise<IDBDatabase> | null = null
function db(): Promise<IDBDatabase> {
  if (_db) return _db
  _db = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const d = req.result
      if (!d.objectStoreNames.contains(STORE)) {
        const s = d.createObjectStore(STORE, { keyPath: 'id' })
        s.createIndex('show', 'show', { unique: false })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return _db
}

export async function listAssets(): Promise<Asset[]> {
  const d = await db()
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, 'readonly')
    const r = tx.objectStore(STORE).getAll()
    r.onsuccess = () => resolve((r.result as Asset[]) || [])
    r.onerror = () => reject(r.error)
  })
}

export async function putAsset(a: Asset): Promise<void> {
  const d = await db()
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(a)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function deleteAsset(id: string): Promise<void> {
  const d = await db()
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

let _seq = 0
export function newAssetId(): string {
  _seq += 1
  return 'as_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7) + _seq
}

// 剧名列表（localStorage）
export function loadShows(): string[] {
  try {
    const a = JSON.parse(localStorage.getItem(SHOWS_KEY) || '[]')
    return Array.isArray(a) ? a : []
  } catch {
    return []
  }
}

export function saveShows(list: string[]): void {
  localStorage.setItem(SHOWS_KEY, JSON.stringify(list))
}
