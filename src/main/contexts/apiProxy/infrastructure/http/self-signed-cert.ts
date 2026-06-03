import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import * as forge from 'node-forge'
import { appDataDir } from '../../../../platform/persistence/paths'

// 本地反代 HTTPS 自签证书（P2-1）。
// - RSA-2048 + X.509，SAN 含 localhost / 127.0.0.1 / ::1，有效期 2 年。
// - 证书 / 私钥落盘到 appDataDir()，私钥文件 chmod 0o600（Unix）。
// - 到期前 30 天阈值自动重新生成（loadOrCreateCert 统一判断）。

const CERT_FILE = 'apiproxy-cert.pem'
const KEY_FILE = 'apiproxy-key.pem'
const VALIDITY_YEARS = 2
const RENEW_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

export interface CertBundle {
  cert: string
  key: string
  /** SHA-256 指纹（小写 hex，无分隔符），供用户 pin / UI 显示。 */
  sha256Fingerprint: string
}

function certDir(): string {
  return appDataDir()
}

/** 计算 PEM 证书的 SHA-256 指纹（hex，无冒号分隔符）。 */
function computeFingerprint(certPem: string): string {
  const cert = forge.pki.certificateFromPem(certPem)
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes()
  const buf = Buffer.from(der, 'binary')
  return createHash('sha256').update(buf).digest('hex')
}

/** 生成新的 RSA-2048 自签证书，落盘并返回 CertBundle。 */
function generateAndPersistCert(dir: string): CertBundle {
  const keypair = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 })
  const cert = forge.pki.createCertificate()

  cert.publicKey = keypair.publicKey
  cert.serialNumber = Date.now().toString(16)

  const now = new Date()
  const expires = new Date(now)
  expires.setFullYear(expires.getFullYear() + VALIDITY_YEARS)
  cert.validity.notBefore = now
  cert.validity.notAfter = expires

  const attrs = [
    { name: 'commonName', value: 'localhost' },
    { name: 'organizationName', value: 'haoxiaoguan local' },
  ]
  cert.setSubject(attrs)
  cert.setIssuer(attrs)

  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
    { name: 'extKeyUsage', serverAuth: true },
    {
      name: 'subjectAltName',
      altNames: [
        { type: 2, value: 'localhost' }, // DNS
        { type: 7, ip: '127.0.0.1' },   // IP
        { type: 7, ip: '::1' },         // IP
      ],
    },
  ])

  cert.sign(keypair.privateKey, forge.md.sha256.create())

  const certPem = forge.pki.certificateToPem(cert)
  const keyPem = forge.pki.privateKeyToPem(keypair.privateKey)

  mkdirSync(dir, { recursive: true })

  const certPath = join(dir, CERT_FILE)
  const keyPath = join(dir, KEY_FILE)

  writeFileSync(certPath, certPem, 'utf8')
  writeFileSync(keyPath, keyPem, 'utf8')

  if (process.platform !== 'win32') {
    try {
      chmodSync(keyPath, 0o600)
    } catch {
      // best-effort; non-fatal
    }
  }

  return { cert: certPem, key: keyPem, sha256Fingerprint: computeFingerprint(certPem) }
}

/**
 * 读取已有证书（存在且距到期 > 30 天），否则重新生成。
 * 注入 dir 参数供测试隔离（默认 appDataDir()）。
 */
export function loadOrCreateCert(dir: string = certDir()): CertBundle {
  const certPath = join(dir, CERT_FILE)
  const keyPath = join(dir, KEY_FILE)

  if (existsSync(certPath) && existsSync(keyPath)) {
    try {
      const certPem = readFileSync(certPath, 'utf8')
      const keyPem = readFileSync(keyPath, 'utf8')
      const parsed = forge.pki.certificateFromPem(certPem)
      const notAfter = parsed.validity.notAfter
      const msUntilExpiry = notAfter.getTime() - Date.now()
      if (msUntilExpiry > RENEW_THRESHOLD_MS) {
        return { cert: certPem, key: keyPem, sha256Fingerprint: computeFingerprint(certPem) }
      }
    } catch {
      // fall through to regenerate
    }
  }

  return generateAndPersistCert(dir)
}
