// 阿里云 OSS 直传：把 base64 / data-URI 图片转成公网 URL。
// 521 视频/图片接口不接受 data URI 参考图，必须公网 URL —— 与「521ai-SD」插件同款 OSS 图床配置。
// 使用 OSS REST API V1 签名（HMAC-SHA1），不依赖 SDK。
import { createHmac, createHash } from 'crypto'

// OSS 凭据从环境变量注入（本地放 .env.local，已 gitignore；CI 从仓库 Secrets 注入），
// 源码里不含任何密钥。electron-vite 打包时会把 import.meta.env.MAIN_VITE_* 静态替换进来。
const E = (import.meta as unknown as { env?: Record<string, string | undefined> }).env || {}
const OSS = {
  accessKeyId: E.MAIN_VITE_OSS_KEY_ID || '',
  accessKeySecret: E.MAIN_VITE_OSS_KEY_SECRET || '',
  bucket: E.MAIN_VITE_OSS_BUCKET || 'rebecceber',
  endpoint: E.MAIN_VITE_OSS_ENDPOINT || 'oss-cn-beijing.aliyuncs.com',
  cdnDomain: E.MAIN_VITE_OSS_CDN || 'https://rebecceber.oss-cn-beijing.aliyuncs.com',
  prefix: E.MAIN_VITE_OSS_PREFIX || 'tuchuang'
}

function mimeToExt(mime: string): string {
  const m = mime.toLowerCase()
  // 图片
  if (m.includes('jpeg') || m.includes('jpg')) return '.jpg'
  if (m.includes('webp')) return '.webp'
  if (m.includes('gif')) return '.gif'
  if (m.includes('bmp')) return '.bmp'
  if (m.includes('png')) return '.png'
  // 音频
  if (m.includes('mpeg') || m.includes('mp3')) return '.mp3'
  if (m.includes('wav')) return '.wav'
  if (m.includes('ogg')) return '.ogg'
  if (m.includes('aac')) return '.aac'
  if (m.includes('mp4') || m.includes('m4a')) return '.m4a'
  if (m.includes('webm')) return '.webm'
  return m.startsWith('audio/') ? '.mp3' : '.png'
}

function parseDataUri(s: string): { buf: Buffer; mime: string; ext: string } | null {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(s.trim())
  if (!m) return null
  const mime = m[1] || 'application/octet-stream'
  return { buf: Buffer.from(m[2], 'base64'), mime, ext: mimeToExt(mime) }
}

// 同一张图（按内容 sha256）只传一次
const cache = new Map<string, string>()

async function uploadDataUri(dataUri: string): Promise<string> {
  const parsed = parseDataUri(dataUri)
  if (!parsed) throw new Error('参考图不是合法的 data URI')
  const sha = createHash('sha256').update(parsed.buf).digest('hex')
  const cached = cache.get(sha)
  if (cached) return cached

  const now = new Date()
  const datePart = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${String(
    now.getUTCDate()
  ).padStart(2, '0')}`
  const key = `${OSS.prefix}/${datePart}/${sha.slice(0, 24)}${parsed.ext}`
  const date = now.toUTCString() // RFC1123 GMT，与签名一致
  const stringToSign = `PUT\n\n${parsed.mime}\n${date}\n/${OSS.bucket}/${key}`
  const signature = createHmac('sha1', OSS.accessKeySecret).update(stringToSign).digest('base64')
  const authorization = `OSS ${OSS.accessKeyId}:${signature}`
  const uploadUrl = `https://${OSS.bucket}.${OSS.endpoint}/${key}`

  // Buffer → Blob（fetch 的 BodyInit 接受 Blob）
  const body = new Blob([new Uint8Array(parsed.buf)], { type: parsed.mime })
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { Date: date, 'Content-Type': parsed.mime, Authorization: authorization },
    body
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`参考图上传图床失败 HTTP ${res.status} — ${t.slice(0, 200)}`)
  }
  const publicUrl = `${OSS.cdnDomain}/${key}`
  cache.set(sha, publicUrl)
  console.log(`[OSS] 上传 ${parsed.mime} (${(parsed.buf.length / 1024).toFixed(0)}KB) -> ${publicUrl}`)
  return publicUrl
}

// 单个：http(s) 原样返回；data URI（图片/音频/视频）→ 上传换公网 URL；其它原样
export async function toPublicUrl(src: string): Promise<string> {
  const s = (src || '').trim()
  if (!s) return s
  if (/^https?:\/\//i.test(s)) return s
  if (/^data:(image|audio|video)\//i.test(s)) return uploadDataUri(s)
  return s
}

// 批量
export async function toPublicUrls(srcs: string[]): Promise<string[]> {
  return Promise.all(srcs.map((s) => toPublicUrl(s)))
}
