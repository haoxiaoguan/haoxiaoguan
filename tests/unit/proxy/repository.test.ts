import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { randomBytes } from 'node:crypto'
import { CryptoService } from '../../../src/main/platform/crypto/crypto-service'
import { MikroOrmProxyRepository } from '../../../src/main/contexts/proxy/infrastructure/mikro-orm-proxy-repository'
import { proxyDedupeKey } from '../../../src/main/contexts/proxy/domain/proxy'
import { createProxyTestOrm, type TestOrm } from './test-orm'

let testOrm: TestOrm
let crypto: CryptoService
let repo: MikroOrmProxyRepository

beforeEach(async () => {
  testOrm = await createProxyTestOrm()
  crypto = new CryptoService(randomBytes(32))
  repo = new MikroOrmProxyRepository(crypto, testOrm.em)
})

afterEach(async () => {
  await testOrm.close()
})

describe('MikroOrmProxyRepository — proxies CRUD', () => {
  it('creates and reads back a proxy, decrypting the password', async () => {
    const created = await repo.createProxy({
      label: 'east-1',
      protocol: 'http',
      host: '1.2.3.4',
      port: 8080,
      username: 'alice',
      password: 's3cret',
      tags: ['prod'],
    })
    expect(created.id).toBeTruthy()
    expect(created.status).toBe('unknown')

    const fetched = await repo.getProxy(created.id)
    expect(fetched).not.toBeNull()
    expect(fetched!.host).toBe('1.2.3.4')
    expect(fetched!.username).toBe('alice')
    expect(fetched!.password).toBe('s3cret') // decrypted for internal use
    expect(fetched!.tags).toEqual(['prod'])
  })

  it('persists the password only as ciphertext (never plaintext in the column)', async () => {
    const created = await repo.createProxy({
      protocol: 'socks5',
      host: 'h',
      port: 1080,
      username: 'u',
      password: 'PLAINTEXT_SENTINEL',
      tags: [],
    })
    const em = testOrm.em()
    const row = await em.getConnection().execute<{ password_enc: string }[]>(
      'SELECT password_enc FROM proxies WHERE id = ?',
      [created.id],
    )
    expect(row[0].password_enc).toBeTruthy()
    expect(row[0].password_enc).not.toContain('PLAINTEXT_SENTINEL')
  })

  it('lists proxies', async () => {
    await repo.createProxy({ protocol: 'http', host: 'a', port: 1, tags: [] })
    await repo.createProxy({ protocol: 'https', host: 'b', port: 2, tags: [] })
    const all = await repo.listProxies()
    expect(all).toHaveLength(2)
  })

  it('updates a proxy and re-encrypts a changed password', async () => {
    const created = await repo.createProxy({
      protocol: 'http',
      host: 'a',
      port: 1,
      username: 'u',
      password: 'old',
      tags: [],
    })
    const updated = await repo.updateProxy(created.id, { label: 'renamed', password: 'new' })
    expect(updated.label).toBe('renamed')
    const fetched = await repo.getProxy(created.id)
    expect(fetched!.password).toBe('new')
  })

  it('deletes a proxy', async () => {
    const created = await repo.createProxy({ protocol: 'http', host: 'a', port: 1, tags: [] })
    await repo.deleteProxy(created.id)
    expect(await repo.getProxy(created.id)).toBeNull()
  })

  it('records a connectivity check result', async () => {
    const created = await repo.createProxy({ protocol: 'http', host: 'a', port: 1, tags: [] })
    await repo.recordCheck(created.id, {
      status: 'ok',
      egressIp: '9.9.9.9',
      latencyMs: 123,
      checkedAt: new Date('2026-06-01T00:00:00.000Z'),
    })
    const fetched = await repo.getProxy(created.id)
    expect(fetched!.status).toBe('ok')
    expect(fetched!.lastEgressIp).toBe('9.9.9.9')
    expect(fetched!.lastLatencyMs).toBe(123)
    expect(fetched!.lastCheckedAt?.toISOString()).toBe('2026-06-01T00:00:00.000Z')
  })

  it('finds a proxy by dedupe key', async () => {
    const created = await repo.createProxy({
      protocol: 'http',
      host: '1.2.3.4',
      port: 8080,
      username: 'alice',
      tags: [],
    })
    const key = proxyDedupeKey({ protocol: 'http', host: '1.2.3.4', port: 8080, username: 'alice' })
    const found = await repo.findByDedupeKey(key)
    expect(found?.id).toBe(created.id)
    const missing = await repo.findByDedupeKey(
      proxyDedupeKey({ protocol: 'http', host: 'nope', port: 1 }),
    )
    expect(missing).toBeNull()
  })
})

describe('MikroOrmProxyRepository — groups + bindings', () => {
  it('creates a group and lists it', async () => {
    const proxy = await repo.createProxy({ protocol: 'http', host: 'a', port: 1, tags: [] })
    const group = await repo.createGroup('team-a', proxy.id)
    expect(group.name).toBe('team-a')
    expect(group.proxyId).toBe(proxy.id)
    const groups = await repo.listGroups()
    expect(groups).toHaveLength(1)
  })

  it('binds an account directly to a proxy (upsert is unique per account)', async () => {
    const proxy = await repo.createProxy({ protocol: 'http', host: 'a', port: 1, tags: [] })
    await repo.bindAccount('acc-1', { proxyId: proxy.id })
    let binding = await repo.getBinding('acc-1')
    expect(binding?.proxyId).toBe(proxy.id)
    expect(binding?.groupId).toBeUndefined()

    // re-binding the same account replaces (still one row)
    const proxy2 = await repo.createProxy({ protocol: 'http', host: 'b', port: 2, tags: [] })
    await repo.bindAccount('acc-1', { proxyId: proxy2.id })
    binding = await repo.getBinding('acc-1')
    expect(binding?.proxyId).toBe(proxy2.id)
    expect(await repo.listBindings()).toHaveLength(1)
  })

  it('binds an account via a group', async () => {
    const proxy = await repo.createProxy({ protocol: 'http', host: 'a', port: 1, tags: [] })
    const group = await repo.createGroup('g', proxy.id)
    await repo.bindAccount('acc-1', { groupId: group.id })
    const binding = await repo.getBinding('acc-1')
    expect(binding?.groupId).toBe(group.id)
    expect(binding?.proxyId).toBeUndefined()
  })

  it('unbinds an account', async () => {
    const proxy = await repo.createProxy({ protocol: 'http', host: 'a', port: 1, tags: [] })
    await repo.bindAccount('acc-1', { proxyId: proxy.id })
    await repo.unbindAccount('acc-1')
    expect(await repo.getBinding('acc-1')).toBeNull()
  })

  it('counts accounts + groups using a proxy (for delete protection)', async () => {
    const proxy = await repo.createProxy({ protocol: 'http', host: 'a', port: 1, tags: [] })
    const group = await repo.createGroup('g', proxy.id)
    await repo.bindAccount('acc-1', { proxyId: proxy.id })
    await repo.bindAccount('acc-2', { proxyId: proxy.id })
    await repo.bindAccount('acc-3', { groupId: group.id })

    expect(await repo.countAccountsForProxy(proxy.id)).toBe(2)
    expect(await repo.countGroupsForProxy(proxy.id)).toBe(1)
    expect(await repo.countAccountsForGroup(group.id)).toBe(1)
  })
})
