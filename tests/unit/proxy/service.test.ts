import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { randomBytes } from 'node:crypto'
import { CryptoService } from '../../../src/main/platform/crypto/crypto-service'
import { MikroOrmProxyRepository } from '../../../src/main/contexts/proxy/infrastructure/mikro-orm-proxy-repository'
import { ProxyService } from '../../../src/main/contexts/proxy/application/proxy-service'
import { ProxyError } from '../../../src/main/contexts/proxy/domain/proxy-error'
import type { ProxyCheckResult, Proxy } from '../../../src/main/contexts/proxy/domain/proxy'
import { createProxyTestOrm, type TestOrm } from './test-orm'

let testOrm: TestOrm
let repo: MikroOrmProxyRepository
let service: ProxyService
// a fake tester whose result we control per test
let testerResult: (proxy: Proxy) => ProxyCheckResult

beforeEach(async () => {
  testOrm = await createProxyTestOrm()
  const crypto = new CryptoService(randomBytes(32))
  repo = new MikroOrmProxyRepository(crypto, testOrm.em)
  testerResult = () => ({ status: 'ok', egressIp: '9.9.9.9', latencyMs: 10, checkedAt: new Date() })
  service = new ProxyService(repo, {
    test: async (proxy: Proxy) => testerResult(proxy),
  })
})

afterEach(async () => {
  await testOrm.close()
})

describe('ProxyService — CRUD + DTO redaction', () => {
  it('creates a proxy and returns a DTO WITHOUT the plaintext password', async () => {
    const dto = await service.createProxy({
      protocol: 'http',
      host: '1.2.3.4',
      port: 8080,
      username: 'alice',
      password: 's3cret',
      tags: [],
    })
    expect(dto.host).toBe('1.2.3.4')
    expect(dto.username).toBe('alice')
    expect(dto.passwordSet).toBe(true)
    expect((dto as Record<string, unknown>).password).toBeUndefined()
    // displayUrl is redacted
    expect(dto.displayUrl).toBe('http://alice:***@1.2.3.4:8080')
  })

  it('passwordSet is false when no password', async () => {
    const dto = await service.createProxy({ protocol: 'http', host: 'h', port: 1, tags: [] })
    expect(dto.passwordSet).toBe(false)
  })

  it('lists proxies as redacted DTOs', async () => {
    await service.createProxy({ protocol: 'http', host: 'a', port: 1, tags: [] })
    const list = await service.listProxies()
    expect(list).toHaveLength(1)
    expect((list[0] as Record<string, unknown>).password).toBeUndefined()
  })
})

describe('ProxyService — import', () => {
  it('imports pasted lines, dedupes, and summarises', async () => {
    // seed an existing proxy that the paste duplicates
    await service.createProxy({ protocol: 'http', host: '1.1.1.1', port: 80, tags: [] })
    const text = [
      '1.1.1.1:80', // duplicate → skipped
      '2.2.2.2:8080:bob:pw',
      'socks5://carol:pw@3.3.3.3:1080',
      'garbage',
    ].join('\n')
    const result = await service.importFromText(text)
    expect(result.imported).toBe(2)
    expect(result.skipped).toBe(1) // the duplicate
    expect(result.failed).toHaveLength(1)
    expect(await service.listProxies()).toHaveLength(3)
  })
})

describe('ProxyService — connectivity test write-back', () => {
  it('writes ok status + egress IP back to the proxy', async () => {
    const dto = await service.createProxy({ protocol: 'http', host: 'a', port: 1, tags: [] })
    const result = await service.testProxy(dto.id)
    expect(result.status).toBe('ok')
    const refreshed = await service.getProxy(dto.id)
    expect(refreshed?.status).toBe('ok')
    expect(refreshed?.lastEgressIp).toBe('9.9.9.9')
  })

  it('writes failed status + reason on a failing test', async () => {
    testerResult = () => ({ status: 'failed', error: 'connect timeout', checkedAt: new Date() })
    const dto = await service.createProxy({ protocol: 'http', host: 'a', port: 1, tags: [] })
    await service.testProxy(dto.id)
    const refreshed = await service.getProxy(dto.id)
    expect(refreshed?.status).toBe('failed')
  })
})

describe('ProxyService — bindings + delete protection', () => {
  it('binds an account to a proxy and reports the binding', async () => {
    const dto = await service.createProxy({ protocol: 'http', host: 'a', port: 1, tags: [] })
    await service.bindAccountToProxy('acc-1', dto.id)
    const binding = await service.getAccountBinding('acc-1')
    expect(binding?.proxyId).toBe(dto.id)
  })

  it('blocks deleting a proxy that is still bound', async () => {
    const dto = await service.createProxy({ protocol: 'http', host: 'a', port: 1, tags: [] })
    await service.bindAccountToProxy('acc-1', dto.id)
    await expect(service.deleteProxy(dto.id)).rejects.toMatchObject({ kind: 'in_use' })
    // proxy still present
    expect(await service.getProxy(dto.id)).not.toBeNull()
  })

  it('allows deleting an unbound proxy', async () => {
    const dto = await service.createProxy({ protocol: 'http', host: 'a', port: 1, tags: [] })
    await service.deleteProxy(dto.id)
    expect(await service.getProxy(dto.id)).toBeNull()
  })

  it('reports binding counts on the proxy DTO', async () => {
    const dto = await service.createProxy({ protocol: 'http', host: 'a', port: 1, tags: [] })
    await service.bindAccountToProxy('acc-1', dto.id)
    await service.bindAccountToProxy('acc-2', dto.id)
    const list = await service.listProxies()
    const found = list.find((p) => p.id === dto.id)
    expect(found?.boundAccountCount).toBe(2)
  })
})

// keep ProxyError import referenced for the type-only matcher above
void ProxyError
