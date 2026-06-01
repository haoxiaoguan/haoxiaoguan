import { describe, it, expect } from 'vitest'
import { ProxyResolver } from '../../../src/main/contexts/proxy/infrastructure/proxy-resolver'
import type {
  Proxy,
  ProxyGroup,
  AccountProxyBinding,
} from '../../../src/main/contexts/proxy/domain/proxy'

// A minimal in-memory stand-in for the slice of MikroOrmProxyRepository the
// resolver depends on. Keeps the resolver test pure (no DB / no ABI rebuild).
class FakeStore {
  proxies = new Map<string, Proxy>()
  groups = new Map<string, ProxyGroup>()
  bindings = new Map<string, AccountProxyBinding>()

  async getBinding(accountId: string): Promise<AccountProxyBinding | null> {
    return this.bindings.get(accountId) ?? null
  }
  async getGroup(id: string): Promise<ProxyGroup | null> {
    return this.groups.get(id) ?? null
  }
  async getProxy(id: string): Promise<Proxy | null> {
    return this.proxies.get(id) ?? null
  }
}

function makeProxy(id: string): Proxy {
  return {
    id,
    protocol: 'http',
    host: `${id}.example.com`,
    port: 8080,
    status: 'unknown',
    tags: [],
    createdAt: new Date(),
  }
}

describe('ProxyResolver.resolveProxyForAccount', () => {
  it('returns the directly-bound proxy', async () => {
    const store = new FakeStore()
    store.proxies.set('p1', makeProxy('p1'))
    store.bindings.set('acc-1', { accountId: 'acc-1', proxyId: 'p1', createdAt: new Date() })
    const resolver = new ProxyResolver(store)
    const proxy = await resolver.resolveProxyForAccount('acc-1')
    expect(proxy?.id).toBe('p1')
  })

  it('follows a group binding to the group proxy', async () => {
    const store = new FakeStore()
    store.proxies.set('p2', makeProxy('p2'))
    store.groups.set('g1', { id: 'g1', name: 'team', proxyId: 'p2', createdAt: new Date() })
    store.bindings.set('acc-2', { accountId: 'acc-2', groupId: 'g1', createdAt: new Date() })
    const resolver = new ProxyResolver(store)
    const proxy = await resolver.resolveProxyForAccount('acc-2')
    expect(proxy?.id).toBe('p2')
  })

  it('returns undefined when the account has no binding (direct connection)', async () => {
    const store = new FakeStore()
    const resolver = new ProxyResolver(store)
    expect(await resolver.resolveProxyForAccount('acc-none')).toBeUndefined()
  })

  it('returns undefined when a group binding points to a missing group', async () => {
    const store = new FakeStore()
    store.bindings.set('acc-3', { accountId: 'acc-3', groupId: 'gone', createdAt: new Date() })
    const resolver = new ProxyResolver(store)
    expect(await resolver.resolveProxyForAccount('acc-3')).toBeUndefined()
  })

  it('returns undefined when a direct binding points to a missing proxy', async () => {
    const store = new FakeStore()
    store.bindings.set('acc-4', { accountId: 'acc-4', proxyId: 'gone', createdAt: new Date() })
    const resolver = new ProxyResolver(store)
    expect(await resolver.resolveProxyForAccount('acc-4')).toBeUndefined()
  })
})
