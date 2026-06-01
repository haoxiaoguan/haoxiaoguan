import { describe, it, expect } from 'vitest'
import {
  ProxyResolver,
  type AccountGroupResolverStore,
} from '../../../src/main/contexts/proxy/infrastructure/proxy-resolver'
import type { Proxy, AccountProxyBinding } from '../../../src/main/contexts/proxy/domain/proxy'

// A minimal in-memory stand-in for the slice of MikroOrmProxyRepository the
// resolver depends on. Keeps the resolver test pure (no DB / no ABI rebuild).
class FakeStore {
  proxies = new Map<string, Proxy>()
  bindings = new Map<string, AccountProxyBinding>()

  async getBinding(accountId: string): Promise<AccountProxyBinding | null> {
    return this.bindings.get(accountId) ?? null
  }
  async getProxy(id: string): Promise<Proxy | null> {
    return this.proxies.get(id) ?? null
  }
}

// In-memory account-group store: account → group ids, group → proxy binding.
class FakeAccountGroupStore implements AccountGroupResolverStore {
  groupsByAccount = new Map<string, Array<{ id: string }>>()
  bindings = new Map<string, { proxyId?: string }>()

  async listGroupsForAccount(accountId: string): Promise<Array<{ id: string }>> {
    return this.groupsByAccount.get(accountId) ?? []
  }
  async getProxyBinding(groupId: string): Promise<{ proxyId?: string } | null> {
    return this.bindings.get(groupId) ?? null
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

describe('ProxyResolver.resolveProxyForAccount — egress precedence', () => {
  it('uses the account proxy when one is bound (account > group)', async () => {
    const store = new FakeStore()
    store.proxies.set('p-acct', makeProxy('p-acct'))
    store.proxies.set('p-group', makeProxy('p-group'))
    store.bindings.set('acc-1', { accountId: 'acc-1', proxyId: 'p-acct', createdAt: new Date() })

    const groupStore = new FakeAccountGroupStore()
    groupStore.groupsByAccount.set('acc-1', [{ id: 'g1' }])
    groupStore.bindings.set('g1', { proxyId: 'p-group' })

    const resolver = new ProxyResolver(store, undefined, groupStore)
    const proxy = await resolver.resolveProxyForAccount('acc-1')
    expect(proxy?.id).toBe('p-acct')
  })

  it('falls back to the group proxy when the account has no proxy', async () => {
    const store = new FakeStore()
    store.proxies.set('p-group', makeProxy('p-group'))

    const groupStore = new FakeAccountGroupStore()
    groupStore.groupsByAccount.set('acc-2', [{ id: 'g1' }])
    groupStore.bindings.set('g1', { proxyId: 'p-group' })

    const resolver = new ProxyResolver(store, undefined, groupStore)
    const proxy = await resolver.resolveProxyForAccount('acc-2')
    expect(proxy?.id).toBe('p-group')
  })

  it('returns undefined (direct) when neither account nor group is bound', async () => {
    const store = new FakeStore()
    const groupStore = new FakeAccountGroupStore()
    groupStore.groupsByAccount.set('acc-3', [{ id: 'g1' }]) // in a group, but the group has no proxy
    const resolver = new ProxyResolver(store, undefined, groupStore)
    expect(await resolver.resolveProxyForAccount('acc-3')).toBeUndefined()
  })

  it('returns undefined when the account has no binding and no group', async () => {
    const store = new FakeStore()
    const resolver = new ProxyResolver(store, undefined, new FakeAccountGroupStore())
    expect(await resolver.resolveProxyForAccount('acc-none')).toBeUndefined()
  })

  it('does NOT fall through to the group when a per-account binding points to a missing proxy', async () => {
    // The account explicitly bound a now-deleted proxy. We must NOT silently
    // reroute through the group — that would change the egress IP behind the
    // user's back.
    const store = new FakeStore()
    store.proxies.set('p-group', makeProxy('p-group'))
    store.bindings.set('acc-4', { accountId: 'acc-4', proxyId: 'gone', createdAt: new Date() })

    const groupStore = new FakeAccountGroupStore()
    groupStore.groupsByAccount.set('acc-4', [{ id: 'g1' }])
    groupStore.bindings.set('g1', { proxyId: 'p-group' })

    const resolver = new ProxyResolver(store, undefined, groupStore)
    expect(await resolver.resolveProxyForAccount('acc-4')).toBeUndefined()
  })

  it('works without an account-group store (proxy-only resolution)', async () => {
    const store = new FakeStore()
    store.proxies.set('p1', makeProxy('p1'))
    store.bindings.set('acc-5', { accountId: 'acc-5', proxyId: 'p1', createdAt: new Date() })
    const resolver = new ProxyResolver(store)
    expect((await resolver.resolveProxyForAccount('acc-5'))?.id).toBe('p1')
    expect(await resolver.resolveProxyForAccount('acc-none')).toBeUndefined()
  })
})
