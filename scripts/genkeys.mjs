// 一次性生成 Ed25519 签名密钥对。
//   - 私钥写到 keys/private_key.pem（已 gitignore，绝不上传/打包）——用来签发激活码
//   - 公钥（SPKI DER 的 base64）打印出来，内置进 App 的 src/main/licensing.ts
// 换密钥会让所有旧激活码失效。运行：node scripts/genkeys.mjs
import { generateKeyPairSync } from 'crypto'
import { mkdirSync, writeFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const keyDir = resolve(root, 'keys')
const privPath = resolve(keyDir, 'private_key.pem')

if (existsSync(privPath) && !process.argv.includes('--force')) {
  console.error('已存在 keys/private_key.pem，若确实要重新生成请加 --force（会让旧激活码全部失效）')
  process.exit(1)
}

const { privateKey, publicKey } = generateKeyPairSync('ed25519')
mkdirSync(keyDir, { recursive: true })
writeFileSync(privPath, privateKey.export({ type: 'pkcs8', format: 'pem' }))
const pubB64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
writeFileSync(resolve(keyDir, 'public_key.txt'), pubB64 + '\n')

console.log('✓ 私钥已写入 keys/private_key.pem（已 gitignore）')
console.log('✓ 公钥（base64，内置进 src/main/licensing.ts 的 PUBLIC_KEY_B64）：')
console.log(pubB64)
