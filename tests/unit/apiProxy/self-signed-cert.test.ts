import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadOrCreateCert } from '../../../src/main/contexts/apiProxy/infrastructure/http/self-signed-cert'
import * as forge from 'node-forge'

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'hxg-cert-test-'))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('loadOrCreateCert', () => {
  it('生成证书：SAN 含 localhost / 127.0.0.1 / ::1', () => {
    const bundle = loadOrCreateCert(tmpDir)
    const cert = forge.pki.certificateFromPem(bundle.cert)
    const san = cert.getExtension('subjectAltName') as any
    expect(san).toBeTruthy()
    const altNames: Array<{ type: number; value?: string; ip?: string }> = san.altNames
    const hasLocalhost = altNames.some((a) => a.type === 2 && a.value === 'localhost')
    const has127 = altNames.some((a) => a.type === 7 && a.ip === '127.0.0.1')
    const hasIPv6 = altNames.some((a) => a.type === 7 && a.ip === '::1')
    expect(hasLocalhost).toBe(true)
    expect(has127).toBe(true)
    expect(hasIPv6).toBe(true)
  })

  it('生成证书：有效期约 2 年（不少于 700 天）', () => {
    const bundle = loadOrCreateCert(tmpDir)
    const cert = forge.pki.certificateFromPem(bundle.cert)
    const msLeft = cert.validity.notAfter.getTime() - Date.now()
    const daysLeft = msLeft / (1000 * 60 * 60 * 24)
    expect(daysLeft).toBeGreaterThan(700)
  })

  it('返回非空 sha256Fingerprint（64 hex 字符）', () => {
    const bundle = loadOrCreateCert(tmpDir)
    expect(bundle.sha256Fingerprint).toMatch(/^[0-9a-f]{64}$/)
  })

  it('cert / key 文件已落盘', () => {
    loadOrCreateCert(tmpDir)
    expect(existsSync(join(tmpDir, 'apiproxy-cert.pem'))).toBe(true)
    expect(existsSync(join(tmpDir, 'apiproxy-key.pem'))).toBe(true)
  })

  it('Unix：私钥文件权限为 0o600', () => {
    if (process.platform === 'win32') return
    loadOrCreateCert(tmpDir)
    const mode = statSync(join(tmpDir, 'apiproxy-key.pem')).mode & 0o777
    expect(mode).toBe(0o600)
  })

  it('loadOrCreateCert：复用未过期的已有证书（不重新生成）', () => {
    const first = loadOrCreateCert(tmpDir)
    const second = loadOrCreateCert(tmpDir)
    expect(second.sha256Fingerprint).toBe(first.sha256Fingerprint)
    expect(second.cert).toBe(first.cert)
  })

  it('loadOrCreateCert：到期证书自动重新生成', () => {
    // 生成一个有效期只剩 1 天的证书（已低于 30 天阈值）
    const keypair = forge.pki.rsa.generateKeyPair({ bits: 1024, e: 0x10001 })
    const cert = forge.pki.createCertificate()
    cert.publicKey = keypair.publicKey
    cert.serialNumber = '01'
    const now = new Date()
    const almostExpired = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000) // 1 day
    cert.validity.notBefore = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000)
    cert.validity.notAfter = almostExpired
    const attrs = [{ name: 'commonName', value: 'localhost' }]
    cert.setSubject(attrs)
    cert.setIssuer(attrs)
    cert.sign(keypair.privateKey, forge.md.sha256.create())

    const expiredCertPem = forge.pki.certificateToPem(cert)
    const expiredKeyPem = forge.pki.privateKeyToPem(keypair.privateKey)
    writeFileSync(join(tmpDir, 'apiproxy-cert.pem'), expiredCertPem, 'utf8')
    writeFileSync(join(tmpDir, 'apiproxy-key.pem'), expiredKeyPem, 'utf8')

    const renewed = loadOrCreateCert(tmpDir)
    // 新证书与过期证书不同
    expect(renewed.cert).not.toBe(expiredCertPem)
    // 新证书有效期 > 700 天
    const newCert = forge.pki.certificateFromPem(renewed.cert)
    const daysLeft = (newCert.validity.notAfter.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    expect(daysLeft).toBeGreaterThan(700)
  })
})
