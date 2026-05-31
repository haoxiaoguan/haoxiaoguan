import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { randomBytes } from 'node:crypto'
import { createTestOrm, type TestOrm } from './test-orm'
import { CryptoService } from '../../../src/main/platform/crypto/crypto-service'
import { MikroOrmCredentialRepository } from '../../../src/main/contexts/credential/infrastructure/mikro-orm-credential-repository'
import { MikroOrmPendingOAuthRepository } from '../../../src/main/contexts/credential/infrastructure/mikro-orm-pending-oauth-repository'
import { MikroOrmPendingImportRepository } from '../../../src/main/contexts/credential/infrastructure/mikro-orm-pending-import-repository'
import { Credential } from '../../../src/main/contexts/credential/domain/credential'
import type { PendingOAuth, PendingImport } from '../../../src/main/contexts/credential/domain/pending-repository'

let testOrm: TestOrm

beforeEach(async () => {
  testOrm = await createTestOrm()
})

afterEach(async () => {
  await testOrm.close()
})

describe('MikroOrmCredentialRepository', () => {
  function repo(): MikroOrmCredentialRepository {
    const crypto = new CryptoService(randomBytes(32))
    return new MikroOrmCredentialRepository(crypto, testOrm.em)
  }

  it('stores and retrieves a credential via envelope round-trip', async () => {
    const r = repo()
    const expires = new Date('2026-06-01T00:00:00.000Z')
    await r.store('acc-1', 'kiro', new Credential('tok', 'rt', expires, { scope: 'x' }))
    const got = await r.retrieve('acc-1')
    expect(got?.token).toBe('tok')
    expect(got?.refreshToken).toBe('rt')
    expect(got?.expiresAt?.toISOString()).toBe(expires.toISOString())
    expect(got?.rawMetadata).toEqual({ scope: 'x' })
  })

  it('returns null for an unknown account', async () => {
    expect(await repo().retrieve('nope')).toBeNull()
  })

  it('loadEnvelope returns the AAD-bound stored envelope', async () => {
    const r = repo()
    await r.store('acc-2', 'cursor', new Credential('tok'))
    const env = await r.loadEnvelope('acc-2')
    expect(env?.aad.provider).toBe('cursor')
    expect(env?.aad.accountId).toBe('acc-2')
    expect(env?.envelope.v).toBe(1)
  })

  it('store replaces an existing credential', async () => {
    const r = repo()
    await r.store('acc-3', 'cursor', new Credential('first'))
    await r.store('acc-3', 'cursor', new Credential('second'))
    expect((await r.retrieve('acc-3'))?.token).toBe('second')
  })

  it('decryption fails when the AAD provider is tampered with', async () => {
    const crypto = new CryptoService(randomBytes(32))
    const r = new MikroOrmCredentialRepository(crypto, testOrm.em)
    await r.store('acc-4', 'kiro', new Credential('tok'))
    // Tamper the stored envelope's AAD provider directly.
    const conn = testOrm.em().getConnection()
    const rows = (await conn.execute('SELECT envelope_json FROM credentials WHERE account_id = ?', [
      'acc-4',
    ])) as Array<{ envelope_json: string }>
    const stored = JSON.parse(rows[0].envelope_json)
    stored.aad.provider = 'cursor'
    await conn.execute('UPDATE credentials SET envelope_json = ? WHERE account_id = ?', [
      JSON.stringify(stored),
      'acc-4',
    ])
    await expect(r.retrieve('acc-4')).rejects.toThrow()
  })

  it('delete removes the credential', async () => {
    const r = repo()
    await r.store('acc-5', 'cursor', new Credential('tok'))
    await r.delete('acc-5')
    expect(await r.retrieve('acc-5')).toBeNull()
  })
})

describe('MikroOrmPendingOAuthRepository', () => {
  function repo(): MikroOrmPendingOAuthRepository {
    return new MikroOrmPendingOAuthRepository(testOrm.em)
  }

  function sample(id: string, expiresAt: Date): PendingOAuth {
    return {
      id,
      provider: 'kiro',
      state: 'state-xyz',
      codeVerifier: 'verifier-abc',
      redirectPath: '/oauth/callback',
      boundPort: 48000,
      createdAt: new Date(),
      expiresAt,
    }
  }

  it('saves and finds a pending record', async () => {
    const r = repo()
    await r.save(sample('p1', new Date(Date.now() + 300_000)))
    const got = await r.findById('p1')
    expect(got?.state).toBe('state-xyz')
    expect(got?.boundPort).toBe(48000)
    expect(got?.provider).toBe('kiro')
  })

  it('upserts on conflict by id', async () => {
    const r = repo()
    const p = sample('p2', new Date(Date.now() + 300_000))
    await r.save(p)
    await r.save({ ...p, state: 'updated' })
    expect((await r.findById('p2'))?.state).toBe('updated')
  })

  it('deletes a pending record', async () => {
    const r = repo()
    await r.save(sample('p3', new Date(Date.now() + 300_000)))
    await r.delete('p3')
    expect(await r.findById('p3')).toBeNull()
  })

  it('purges only expired rows', async () => {
    const r = repo()
    await r.save(sample('old', new Date(Date.now() - 60_000)))
    await r.save(sample('fresh', new Date(Date.now() + 300_000)))
    expect(await r.purgeExpired(new Date())).toBe(1)
    expect(await r.findById('old')).toBeNull()
    expect(await r.findById('fresh')).not.toBeNull()
  })
})

describe('MikroOrmPendingImportRepository', () => {
  function repo(): MikroOrmPendingImportRepository {
    return new MikroOrmPendingImportRepository(testOrm.em)
  }

  function sample(id: string, expiresAt: Date): PendingImport {
    return {
      id,
      provider: 'kiro',
      payloadJson: '{"access_token":"tok"}',
      createdAt: new Date(),
      expiresAt,
    }
  }

  it('save/find/delete round-trip', async () => {
    const r = repo()
    await r.save(sample('i1', new Date(Date.now() + 300_000)))
    expect(await r.findById('i1')).not.toBeNull()
    await r.delete('i1')
    expect(await r.findById('i1')).toBeNull()
  })

  it('purges only expired imports', async () => {
    const r = repo()
    await r.save(sample('old', new Date(Date.now() - 60_000)))
    await r.save(sample('fresh', new Date(Date.now() + 300_000)))
    expect(await r.purgeExpired(new Date())).toBe(1)
    expect(await r.findById('old')).toBeNull()
    expect(await r.findById('fresh')).not.toBeNull()
  })
})
