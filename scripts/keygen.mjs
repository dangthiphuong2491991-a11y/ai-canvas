// 用私钥签发「机器码绑定」的激活码。
// 用法：node scripts/keygen.mjs <机器码> [备注名] [有效天数]
//   永久：  node scripts/keygen.mjs A1B2-C3D4-E5F6-G7H8-I9J0-K1L2 张三
//   按时长：node scripts/keygen.mjs A1B2-... 张三 365
// 机器码由客户在激活界面里看到并发给你。私钥在 keys/private_key.pem（绝不外发）。
import { sign, createPrivateKey } from 'crypto'
import { readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const privPath = resolve(root, 'keys/private_key.pem')
if (!existsSync(privPath)) {
  console.error('找不到 keys/private_key.pem，请先运行：node scripts/genkeys.mjs')
  process.exit(1)
}

const mid = (process.argv[2] || '').trim()
const name = process.argv[3] || ''
const days = process.argv[4] ? Number(process.argv[4]) : 0
if (!mid) {
  console.error('用法: node scripts/keygen.mjs <机器码> [备注名] [有效天数]')
  process.exit(1)
}

const priv = createPrivateKey(readFileSync(privPath))
const payload = { mid, name, exp: days > 0 ? Date.now() + days * 86400000 : null, iat: Date.now() }
const payloadB = Buffer.from(JSON.stringify(payload))
const sig = sign(null, payloadB, priv)
const b64url = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const code = b64url(payloadB) + '.' + b64url(sig)

console.log('机器码 :', mid)
console.log('备注   :', name || '(无)')
console.log('有效期 :', days > 0 ? days + ' 天' : '永久')
console.log('—— 激活码（发给客户）——')
console.log(code)
