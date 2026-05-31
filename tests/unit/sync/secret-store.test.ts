import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SafeStorageSecretStore } from '../../../src/main/contexts/sync/infrastructure/secret-store'
import { KeychainMasterKeyStore } from '../../../src/main/contexts/sync/infrastructure/keychain-master-key-store'
import { SyncError } from '../../../src/main/contexts/sync/domain/sync-error'

// Under vitest there is no Electron runtime, so getSafeStorage() returns null and
// both stores operate in their documented degraded (raw) mode — which is exactly
// what we exercise here (file persistence + round-trips).

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'hxg-store-'))
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe('SafeStorageSecretStore (degraded raw mode)', () => {
  it('returns null when unset', async () => {
    const store = new SafeStorageSecretStore(join(tmp, 'webdav.pw'))
    expect(await store.get()).toBeNull()
  })

  it('set then get round-trips', async () => {
    const store = new SafeStorageSecretStore(join(tmp, 'sync.pw'))
    await store.set('s3cr3t-pw')
    expect(await store.get()).toBe('s3cr3t-pw')
  })

  it('clear removes the secret', async () => {
    const store = new SafeStorageSecretStore(join(tmp, 'sync.pw'))
    await store.set('x')
    await store.clear()
    expect(await store.get()).toBeNull()
    // clear is idempotent.
    await expect(store.clear()).resolves.toBeUndefined()
  })
})

describe('KeychainMasterKeyStore (degraded raw mode)', () => {
  it('store then load round-trips a 32-byte key', async () => {
    const store = new KeychainMasterKeyStore(tmp)
    const key = randomBytes(32)
    await store.store(key)
    const loaded = await store.load()
    expect(loaded.equals(key)).toBe(true)
  })

  it('store rejects a non-32-byte key', async () => {
    const store = new KeychainMasterKeyStore(tmp)
    await expect(store.store(randomBytes(16))).rejects.toBeInstanceOf(SyncError)
  })

  it('load throws when no key file exists', async () => {
    const store = new KeychainMasterKeyStore(join(tmp, 'empty'))
    await expect(store.load()).rejects.toBeInstanceOf(SyncError)
  })
})
