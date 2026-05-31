import { describe, it, expect } from 'vitest'
import { randomBytes } from 'node:crypto'
import {
  wrapMasterKey,
  unwrapMasterKey,
  SyncCryptoError,
  type WrappedKey,
} from '../../../src/main/contexts/sync/domain/sync-crypto'

// Sync crypto round-trips the 32-byte master key under a sync password.
// PBKDF2 (600k iters) makes these tests a little slow but they must use the real
// parameters for cross-device byte compatibility with the Rust app.

const KEY_ID = '00000000-0000-0000-0000-000000000000'

function key32(): Buffer {
  return randomBytes(32)
}

describe('sync-crypto wrap/unwrap', () => {
  it('round-trips the master key with the correct password', async () => {
    const master = key32()
    const wrapped = await wrapMasterKey('correct horse battery', KEY_ID, master)

    expect(wrapped.version).toBe(1)
    expect(wrapped.keyId).toBe(KEY_ID)
    // salt is 16 bytes, nonce 12 bytes (base64-encoded).
    expect(Buffer.from(wrapped.salt, 'base64').length).toBe(16)
    expect(Buffer.from(wrapped.nonce, 'base64').length).toBe(12)
    // ciphertext = 32-byte key + 16-byte GCM tag.
    expect(Buffer.from(wrapped.ciphertext, 'base64').length).toBe(48)

    const { keyId, key } = await unwrapMasterKey('correct horse battery', wrapped)
    expect(keyId).toBe(KEY_ID)
    expect(key.equals(master)).toBe(true)
  }, 20_000)

  it('fails to unwrap with the wrong password (decrypt error)', async () => {
    const wrapped = await wrapMasterKey('right-password', KEY_ID, key32())
    await expect(unwrapMasterKey('wrong-password', wrapped)).rejects.toMatchObject({
      kind: 'decrypt',
    })
  }, 20_000)

  it('fails when keyId is tampered (AAD binding)', async () => {
    const wrapped = await wrapMasterKey('pw', KEY_ID, key32())
    const tampered: WrappedKey = { ...wrapped, keyId: 'ffffffff-0000-0000-0000-000000000000' }
    await expect(unwrapMasterKey('pw', tampered)).rejects.toBeInstanceOf(SyncCryptoError)
  }, 20_000)

  it('rejects unsupported version on unwrap', async () => {
    const wrapped = await wrapMasterKey('pw', KEY_ID, key32())
    const bad: WrappedKey = { ...wrapped, version: 2 }
    await expect(unwrapMasterKey('pw', bad)).rejects.toMatchObject({ kind: 'malformed' })
  }, 20_000)

  it('rejects a non-32-byte master key on wrap', async () => {
    await expect(wrapMasterKey('pw', KEY_ID, randomBytes(16))).rejects.toMatchObject({
      kind: 'encrypt',
    })
  })
})
