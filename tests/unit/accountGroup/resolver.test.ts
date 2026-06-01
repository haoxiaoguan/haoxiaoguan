import { describe, expect, it } from 'vitest'
import {
  ProxyResolver,
  type AccountGroupResolverStore,
  type ProxyResolverStore,
} from '../../../src/main/contexts/proxy/infrastructure/proxy-resolver'
import type { Proxy } from '../../../src/main/contexts/proxy/domain/proxy'

const makeProxy = (id: string): Proxy => ({
  id,
  protocol: 'http',
  host: '203.0.113.7',
  port: 8080,
  status: 'unknown',
  tags: [],
  createdAt: new Date(),
})

describe('ProxyResolver — account-group fallback', () => {
  function buildStore(opts: {
    binding?: { groupId?: string; proxyId?: string } | null
    proxies?: Map<string, Proxy>
  }): ProxyResolverStore {
    const proxies = opts.proxies ?? new Map<string, Proxy>()
    return {
      async getBinding(_accountId: string) {
        if (opts.binding === undefined || opts.binding === null) return null
        return {
          accountId: 'acc',
          ...opts.binding,
          createdAt: new Date(),
        }
      },
      async getGroup(_id: string) {
        return null
      },
      async getProxy(id: string) {
        return proxies.get(id) ?? null
      },
    }
  }

  function buildAccountGroupStore(opts: {
    groupsForAccount?: Array<{ id: string }>
    bindings?: Map<string, { proxyId?: string; proxyGroupId?: string }>
  }): AccountGroupResolverStore {
    return {
      async listGroupsForAccount() {
        return opts.groupsForAccount ?? []
      },
      async getProxyBinding(groupId: string) {
        return opts.bindings?.get(groupId) ?? null
      },
    }
  }

  it('returns the per-account binding when one exists', async () => {
    const proxy = makeProxy('p-direct')
    const proxies = new Map([[proxy.id, proxy]])
    const resolver = new ProxyResolver(
      buildStore({ binding: { proxyId: proxy.id }, proxies }),
      undefined,
      buildAccountGroupStore({}),
    )
    const result = await resolver.resolveProxyForAccount('acc')
    expect(result?.id).toBe('p-direct')
  })

  it('falls back to the first group binding when there is no per-account binding', async () => {
    const groupProxy = makeProxy('p-via-group')
    const proxies = new Map([[groupProxy.id, groupProxy]])
    const resolver = new ProxyResolver(
      buildStore({ binding: null, proxies }),
      undefined,
      buildAccountGroupStore({
        groupsForAccount: [{ id: 'g-1' }, { id: 'g-2' }],
        bindings: new Map([['g-1', { proxyId: groupProxy.id }]]),
      }),
    )
    const result = await resolver.resolveProxyForAccount('acc')
    expect(result?.id).toBe('p-via-group')
  })

  it('skips groups whose binding does not resolve and tries the next', async () => {
    const groupProxy = makeProxy('p-second-group')
    const proxies = new Map([[groupProxy.id, groupProxy]])
    const resolver = new ProxyResolver(
      buildStore({ binding: null, proxies }),
      undefined,
      buildAccountGroupStore({
        groupsForAccount: [{ id: 'g-1' }, { id: 'g-2' }],
        bindings: new Map([
          ['g-1', { proxyId: 'p-missing' }],
          ['g-2', { proxyId: groupProxy.id }],
        ]),
      }),
    )
    const result = await resolver.resolveProxyForAccount('acc')
    expect(result?.id).toBe('p-second-group')
  })

  it('returns undefined when no per-account binding and no group binding resolves', async () => {
    const resolver = new ProxyResolver(
      buildStore({ binding: null }),
      undefined,
      buildAccountGroupStore({
        groupsForAccount: [{ id: 'g-1' }],
        bindings: new Map(),
      }),
    )
    expect(await resolver.resolveProxyForAccount('acc')).toBeUndefined()
  })

  it('does NOT fall through to group resolution when the per-account binding exists but its proxy is gone', async () => {
    // The user explicitly bound this account to a proxy that has since been
    // deleted. We must NOT silently route through the group instead — the
    // user's intent was specific to that one proxy.
    const groupProxy = makeProxy('p-group')
    const proxies = new Map([[groupProxy.id, groupProxy]])
    const resolver = new ProxyResolver(
      buildStore({ binding: { proxyId: 'p-deleted' }, proxies }),
      undefined,
      buildAccountGroupStore({
        groupsForAccount: [{ id: 'g-1' }],
        bindings: new Map([['g-1', { proxyId: groupProxy.id }]]),
      }),
    )
    expect(await resolver.resolveProxyForAccount('acc')).toBeUndefined()
  })
})
