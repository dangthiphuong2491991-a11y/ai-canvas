// 离线激活（Ed25519 机器码绑定）。App 只内置公钥；签发用的私钥在 keys/private_key.pem（仅本机、gitignore）。
// 激活码格式：base64url(payloadJSON) + "." + base64url(signature)
//   payload = { mid, name?, exp?(ms|null), iat }
// 校验：验签 → 机器码必须等于本机 → 未过期。私钥不在场 = 无法伪造激活码。
import { app } from 'electron'
import { createHash, createPublicKey, verify as edVerify } from 'crypto'
import { execSync } from 'child_process'
import os from 'os'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'

// 内置公钥（SPKI DER 的 base64）——由 scripts/genkeys.mjs 生成
const PUBLIC_KEY_B64 = 'MCowBQYDK2VwAyEAMhfH9rTPoQafftwLAAZET3EmeftaOUSc46w7PyzfdNg='

interface Payload {
  mid: string
  name?: string
  exp?: number | null
  iat?: number
}

let cachedMid: string | null = null
let activatedCache = false

function rawMachineId(): string {
  try {
    if (process.platform === 'win32') {
      const out = execSync('reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid', {
        encoding: 'utf8'
      })
      const m = out.match(/MachineGuid\s+REG_SZ\s+([\w-]+)/i)
      if (m) return 'win:' + m[1]
    } else if (process.platform === 'darwin') {
      const out = execSync('ioreg -rd1 -c IOPlatformExpertDevice', { encoding: 'utf8' })
      const m = out.match(/IOPlatformUUID"\s*=\s*"([\w-]+)"/)
      if (m) return 'mac:' + m[1]
    } else if (existsSync('/etc/machine-id')) {
      return 'linux:' + readFileSync('/etc/machine-id', 'utf8').trim()
    }
  } catch {
    /* 回退到 hostname + MAC */
  }
  const nets = os.networkInterfaces()
  let mac = ''
  for (const k of Object.keys(nets)) {
    for (const ni of nets[k] || []) {
      if (!ni.internal && ni.mac && ni.mac !== '00:00:00:00:00:00') {
        mac = ni.mac
        break
      }
    }
    if (mac) break
  }
  return 'fb:' + os.hostname() + '|' + mac
}

// 本机机器码：稳定、可展示（形如 A1B2-C3D4-E5F6-...）
export function getMachineId(): string {
  if (cachedMid) return cachedMid
  const h = createHash('sha256').update(rawMachineId()).digest('hex').slice(0, 24).toUpperCase()
  cachedMid = h.match(/.{1,4}/g)!.join('-')
  return cachedMid
}

function b64urlToBuf(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

// 校验一段激活码（不落盘）
export function verifyCode(code: string): { valid: boolean; reason?: string; payload?: Payload } {
  try {
    const clean = (code || '').trim().replace(/\s+/g, '')
    const dot = clean.indexOf('.')
    if (dot <= 0) return { valid: false, reason: '激活码格式不对' }
    const payloadB = b64urlToBuf(clean.slice(0, dot))
    const sig = b64urlToBuf(clean.slice(dot + 1))
    const pub = createPublicKey({
      key: Buffer.from(PUBLIC_KEY_B64, 'base64'),
      format: 'der',
      type: 'spki'
    })
    if (!edVerify(null, payloadB, pub, sig)) return { valid: false, reason: '激活码无效（签名不匹配）' }
    const payload = JSON.parse(payloadB.toString('utf8')) as Payload
    if (payload.mid !== getMachineId())
      return { valid: false, reason: '激活码与本机机器码不符（请用本机机器码重新签发）' }
    if (payload.exp && Date.now() > payload.exp) return { valid: false, reason: '激活码已过期' }
    return { valid: true, payload }
  } catch {
    return { valid: false, reason: '激活码解析失败' }
  }
}

function licenseFile(): string {
  return join(app.getPath('userData'), 'license.json')
}

export interface LicenseStatus {
  activated: boolean
  machineId: string
  name?: string
  exp?: number | null
  reason?: string
}

// 读取本机已保存的激活状态（启动时调用，并刷新内存缓存）
export function loadStatus(): LicenseStatus {
  const machineId = getMachineId()
  try {
    const f = licenseFile()
    if (existsSync(f)) {
      const { code } = JSON.parse(readFileSync(f, 'utf8')) as { code?: string }
      const r = verifyCode(code || '')
      if (r.valid) {
        activatedCache = true
        return { activated: true, machineId, name: r.payload?.name, exp: r.payload?.exp ?? null }
      }
      activatedCache = false
      return { activated: false, machineId, reason: r.reason }
    }
  } catch {
    /* ignore */
  }
  activatedCache = false
  return { activated: false, machineId }
}

// 提交一段激活码 → 校验通过则落盘
export function activate(code: string): { ok: boolean; reason?: string; name?: string; exp?: number | null } {
  const r = verifyCode(code)
  if (!r.valid) return { ok: false, reason: r.reason }
  try {
    mkdirSync(app.getPath('userData'), { recursive: true })
    writeFileSync(licenseFile(), JSON.stringify({ code: code.trim() }), 'utf8')
  } catch {
    /* ignore */
  }
  activatedCache = true
  return { ok: true, name: r.payload?.name, exp: r.payload?.exp ?? null }
}

// 主进程其它接口（如生成）用它兜底：未激活直接拒绝，防止有人绕过前端激活界面
export function isActivated(): boolean {
  return activatedCache
}
