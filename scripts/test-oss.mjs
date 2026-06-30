// 验证阿里云 OSS 直传签名 + 公网可读（与 ossUpload.ts 同逻辑）
import { createHmac, createHash } from 'crypto'

// 密钥从环境变量读取（运行前设置，或先 source .env.local），脚本里不写死任何密钥。
const OSS = {
  accessKeyId: process.env.MAIN_VITE_OSS_KEY_ID || '',
  accessKeySecret: process.env.MAIN_VITE_OSS_KEY_SECRET || '',
  bucket: process.env.MAIN_VITE_OSS_BUCKET || 'rebecceber',
  endpoint: process.env.MAIN_VITE_OSS_ENDPOINT || 'oss-cn-beijing.aliyuncs.com',
  cdnDomain: process.env.MAIN_VITE_OSS_CDN || 'https://rebecceber.oss-cn-beijing.aliyuncs.com',
  prefix: process.env.MAIN_VITE_OSS_PREFIX || 'tuchuang'
}
if (!OSS.accessKeyId) {
  console.error('请先设置环境变量 MAIN_VITE_OSS_KEY_ID / MAIN_VITE_OSS_KEY_SECRET 再运行')
  process.exit(1)
}

// 1x1 红点 PNG
const dataUri =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUri)
const mime = m[1]
const buf = Buffer.from(m[2], 'base64')
const sha = createHash('sha256').update(buf).digest('hex')
const now = new Date()
const datePart = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${String(now.getUTCDate()).padStart(2, '0')}`
const key = `${OSS.prefix}/${datePart}/${sha.slice(0, 24)}.png`
const date = now.toUTCString()
const stringToSign = `PUT\n\n${mime}\n${date}\n/${OSS.bucket}/${key}`
const signature = createHmac('sha1', OSS.accessKeySecret).update(stringToSign).digest('base64')
const authorization = `OSS ${OSS.accessKeyId}:${signature}`
const uploadUrl = `https://${OSS.bucket}.${OSS.endpoint}/${key}`
const publicUrl = `${OSS.cdnDomain}/${key}`

console.log('objectKey:', key)
console.log('uploadUrl:', uploadUrl)

const put = await fetch(uploadUrl, {
  method: 'PUT',
  headers: { Date: date, 'Content-Type': mime, Authorization: authorization },
  body: new Blob([new Uint8Array(buf)], { type: mime })
})
console.log('PUT status:', put.status)
if (!put.ok) {
  console.log('PUT body:', (await put.text()).slice(0, 400))
  process.exit(1)
}

const get = await fetch(publicUrl)
const gotBytes = Buffer.from(await get.arrayBuffer())
console.log('GET status:', get.status, 'bytes:', gotBytes.length, 'match:', gotBytes.equals(buf))
console.log('publicUrl:', publicUrl)
