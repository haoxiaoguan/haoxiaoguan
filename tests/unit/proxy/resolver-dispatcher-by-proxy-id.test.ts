import { describe, it, expect, vi } from 'vitest'
import { ProxyResolver } from '../../../src/main/contexts/proxy/infrastructure/proxy-resolver'
import type { Proxy } from '../../../src/main/contexts/proxy/domain/proxy'
import type { Dispatcher } from 'undici'

// Minimal in-memory store: only getProxy needed for dispatcherForProxyId.
class FakeStore {
  proxies = new Map<string, Proxy>()

  async getBinding() {
    return null
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

function makeFactory(dispatcher: Dispatcher) {
  return { dispatcherFor: vi.fn(() => dispatcher) }
}

describe('ProxyResolver.dispatcherForProxyId', () => {
  it('returns a dispatcher when proxyId hits a known proxy', async () => {
    const store = new FakeStore()
    const proxy = makeProxy('p1')
    store.proxies.set('p1', proxy)
    const fakeDispatcher = { marker: 'D1' } as unknown as Dispatcher
    const factory = makeFactory(fakeDispatcher)

    const resolver = new ProxyResolver(store, factory as any)
    const result = await resolver.dispatcherForProxyId('p1')

    expect(result).toBe(fakeDispatcher)
    expect(factory.dispatcherFor).toHaveBeenCalledWith(proxy)
  })

  it('returns undefined when the proxy does not exist', async () => {
    const store = new FakeStore()
    const fakeDispatcher = { marker: 'D2' } as unknown as Dispatcher
    const factory = makeFactory(fakeDispatcher)

    const resolver = new ProxyResolver(store, factory as any)
    const result = await resolver.dispatcherForProxyId('missing')

    expect(result).toBeUndefined()
    expect(factory.dispatcherFor).not.toHaveBeenCalled()
  })

  it('returns undefined when no dispatcher factory is injected', async () => {
    const store = new FakeStore()
    store.proxies.set('p3', makeProxy('p3'))

    // No factory (third argument omitted → undefined)
    const resolver = new ProxyResolver(store)
    const result = await resolver.dispatcherForProxyId('p3')

    expect(result).toBeUndefined()
  })
})
