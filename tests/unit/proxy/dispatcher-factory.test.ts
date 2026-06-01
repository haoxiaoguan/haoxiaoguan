import { describe, it, expect } from 'vitest'
import { Dispatcher } from 'undici'
import { ProxyDispatcherFactory } from '../../../src/main/contexts/proxy/infrastructure/proxy-dispatcher-factory'
import type { Proxy } from '../../../src/main/contexts/proxy/domain/proxy'

function makeProxy(over: Partial<Proxy>): Proxy {
  return {
    id: over.id ?? 'p',
    protocol: over.protocol ?? 'http',
    host: over.host ?? '127.0.0.1',
    port: over.port ?? 8080,
    username: over.username,
    password: over.password,
    status: 'unknown',
    tags: [],
    createdAt: new Date(),
  }
}

describe('ProxyDispatcherFactory', () => {
  it('builds a Dispatcher for an http proxy', () => {
    const factory = new ProxyDispatcherFactory()
    const d = factory.dispatcherFor(makeProxy({ protocol: 'http' }))
    expect(d).toBeInstanceOf(Dispatcher)
  })

  it('builds a Dispatcher for an https proxy', () => {
    const factory = new ProxyDispatcherFactory()
    const d = factory.dispatcherFor(makeProxy({ protocol: 'https', port: 3128 }))
    expect(d).toBeInstanceOf(Dispatcher)
  })

  it('builds a Dispatcher for a socks5 proxy (with auth)', () => {
    const factory = new ProxyDispatcherFactory()
    const d = factory.dispatcherFor(
      makeProxy({ protocol: 'socks5', port: 1080, username: 'u', password: 'p' }),
    )
    expect(d).toBeInstanceOf(Dispatcher)
  })

  it('caches the dispatcher by proxy URL (same identity returns same instance)', () => {
    const factory = new ProxyDispatcherFactory()
    const proxy = makeProxy({ protocol: 'http', host: 'h', port: 1, username: 'u', password: 'p' })
    const a = factory.dispatcherFor(proxy)
    const b = factory.dispatcherFor({ ...proxy, id: 'different-id' }) // id not part of key
    expect(a).toBe(b)
  })

  it('returns distinct dispatchers when the password differs', () => {
    const factory = new ProxyDispatcherFactory()
    const base = makeProxy({ protocol: 'http', host: 'h', port: 1, username: 'u', password: 'p1' })
    const a = factory.dispatcherFor(base)
    const b = factory.dispatcherFor({ ...base, password: 'p2' })
    expect(a).not.toBe(b)
  })

  it('clears a cached dispatcher (and closes it)', async () => {
    const factory = new ProxyDispatcherFactory()
    const proxy = makeProxy({ protocol: 'http', host: 'h', port: 9 })
    const a = factory.dispatcherFor(proxy)
    await factory.evict(proxy)
    const b = factory.dispatcherFor(proxy)
    expect(a).not.toBe(b)
  })
})
