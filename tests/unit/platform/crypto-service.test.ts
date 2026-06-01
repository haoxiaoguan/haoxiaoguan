import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import {
  CryptoService,
  loadOrCreateMasterKey,
  type EnvelopeAad,
} from '../../../src/main/platform/crypto/crypto-service'

const key = randomBytes(32)
const aad: EnvelopeAad = {
  provider: 'cursor',
  accountId: '11111111-1111-4111-8111-111111111111',
  createdAt: '2026-05-31T00:00:00.000Z',
}

describe('CryptoService', () => {
  it('round-trips plaintext through encrypt/decrypt', () => {
    const svc = new CryptoService(key)
    const env = svc.encrypt('secret-token', aad)
    expect(svc.decrypt(env, aad)).toBe('secret-token')
  })

  it('fails to decrypt when AAD is tampered', () => {
    const svc = new CryptoService(key)
    const env = svc.encrypt('secret-token', aad)
    const badAad = { ...aad, accountId: '22222222-2222-4222-8222-222222222222' }
    expect(() => svc.decrypt(env, badAad)).toThrow()
  })

  it('produces a fresh IV per encryption', () => {
    const svc = new CryptoService(key)
    const a = svc.encrypt('x', aad)
    const b = svc.encrypt('x', aad)
    expect(a.iv).not.toBe(b.iv)
  })

  it('rejects a master key that is not 32 bytes', () => {
    expect(() => new CryptoService(randomBytes(16))).toThrow()
  })
})

// The original quota crypto bug: loadOrCreateMasterKey silently regenerated the
// key whenever it couldn't decode an existing file, orphaning every credential
// sealed under the old key (decrypt → "Unsupported state or unable to
// authenticate data"). These guard that it is STABLE and NON-DESTRUCTIVE. Under
// vitest the electron stub reports app.isPackaged=false and safeStorage
// unavailable, so the dev raw-base64 path is exercised.
describe('loadOrCreateMasterKey', () => {
  function tempKeyFile(): { dir: string; file: string } {
    const dir = mkdtempSync(join(tmpdir(), 'hxg-key-'))
    return { dir, file: join(dir, 'master.key.enc') }
  }

  it('returns the SAME key across repeated loads (stability)', async () => {
    const { dir, file } = tempKeyFile()
    try {
      const first = await loadOrCreateMasterKey(file)
      const second = await loadOrCreateMasterKey(file)
      const third = await loadOrCreateMasterKey(file)
      expect(first.length).toBe(32)
      expect(second.equals(first)).toBe(true)
      expect(third.equals(first)).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a credential sealed on first launch decrypts after a key reload', async () => {
    const { dir, file } = tempKeyFile()
    try {
      const aad2: EnvelopeAad = {
        provider: 'codex',
        accountId: '2e3473f9-7076-4db2-b9c1-af98de837adb',
        createdAt: '2026-05-31T20:09:52.317Z',
      }
      const keyA = await loadOrCreateMasterKey(file)
      const env = new CryptoService(keyA).encrypt('codex-token', aad2)
      // Simulate a relaunch: load the key again from the SAME file.
      const keyB = await loadOrCreateMasterKey(file)
      expect(new CryptoService(keyB).decrypt(env, aad2)).toBe('codex-token')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('persists with 0600 perms and base64 raw encoding in dev', async () => {
    const { dir, file } = tempKeyFile()
    try {
      const key = await loadOrCreateMasterKey(file)
      const onDisk = readFileSync(file, 'utf8')
      expect(Buffer.from(onDisk, 'base64').equals(key)).toBe(true)
      if (process.platform !== 'win32') {
        expect(statSync(file).mode & 0o777).toBe(0o600)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('refuses to overwrite an undecodable key file (never orphans credentials)', async () => {
    const { dir, file } = tempKeyFile()
    try {
      // A garbage file that decodes to neither a 32-byte safeStorage blob nor a
      // valid base64 key. The loader must throw, not regenerate.
      writeFileSync(file, '!!! not base64 and not 32 bytes !!!', 'utf8')
      const before = readFileSync(file)
      await expect(loadOrCreateMasterKey(file)).rejects.toThrow(/refusing to overwrite/)
      expect(readFileSync(file).equals(before)).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
