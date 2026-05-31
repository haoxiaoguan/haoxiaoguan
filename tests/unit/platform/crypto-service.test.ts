import { describe, it, expect } from 'vitest'
import { randomBytes } from 'node:crypto'
import { CryptoService, type EnvelopeAad } from '../../../src/main/platform/crypto/crypto-service'

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
