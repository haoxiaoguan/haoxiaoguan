import { ProxyAgent, Agent, type Dispatcher } from 'undici'
import { socksDispatcher } from 'fetch-socks'
import { proxyDedupeKey, proxyUrl, type Proxy, type ProxyProtocol } from '../domain/proxy'

// ProxyDispatcherFactory — turns a (decrypted) Proxy into an undici Dispatcher
// suitable for `fetch(url, { dispatcher })`.
//
//  • http / https → undici ProxyAgent (HTTP CONNECT tunnelling). Auth is sent as
//    a Basic Proxy-Authorization token built from username:password.
//  • socks5       → fetch-socks socksDispatcher (an undici Agent over a SOCKS
//    connector). userId/password set the SOCKS auth.
//
// Dispatchers are cached by an identity key that INCLUDES credentials (URL with
// auth) so a password change yields a fresh dispatcher. Connections are pooled
// inside each dispatcher, so we reuse rather than rebuild per request.

const KEEPALIVE_TIMEOUT_MS = 10_000

export class ProxyDispatcherFactory {
  private readonly cache = new Map<string, Dispatcher>()

  /** Build (or reuse) a Dispatcher for the given proxy. */
  dispatcherFor(proxy: Proxy): Dispatcher {
    const key = this.cacheKey(proxy)
    const existing = this.cache.get(key)
    if (existing !== undefined) return existing
    const dispatcher = this.build(proxy)
    this.cache.set(key, dispatcher)
    return dispatcher
  }

  /** Drop (and close) any cached dispatcher for this proxy identity. */
  async evict(proxy: Proxy): Promise<void> {
    const key = this.cacheKey(proxy)
    const existing = this.cache.get(key)
    if (existing !== undefined) {
      this.cache.delete(key)
      await existing.close().catch(() => {})
    }
  }

  /** Close every cached dispatcher (call on app quit). */
  async closeAll(): Promise<void> {
    const all = [...this.cache.values()]
    this.cache.clear()
    await Promise.all(all.map((d) => d.close().catch(() => {})))
  }

  private build(proxy: Proxy): Dispatcher {
    if (proxy.protocol === 'socks5') return this.buildSocks(proxy)
    return this.buildHttp(proxy)
  }

  private buildHttp(proxy: Proxy): Dispatcher {
    // ProxyAgent uri carries scheme+host+port (NO credentials — those go in the
    // Basic token so they aren't logged in connection URLs).
    const uri = `${proxy.protocol}://${proxy.host}:${proxy.port}`
    const options: ProxyAgent.Options = { uri, connections: 16 }
    if (proxy.username !== undefined && proxy.username !== '') {
      const raw = `${proxy.username}:${proxy.password ?? ''}`
      options.token = `Basic ${Buffer.from(raw, 'utf8').toString('base64')}`
    }
    return new ProxyAgent(options)
  }

  private buildSocks(proxy: Proxy): Dispatcher {
    const hasAuth = proxy.username !== undefined && proxy.username !== ''
    return socksDispatcher(
      {
        type: 5,
        host: proxy.host,
        port: proxy.port,
        ...(hasAuth ? { userId: proxy.username, password: proxy.password ?? '' } : {}),
      },
      { connections: 16, connect: { timeout: KEEPALIVE_TIMEOUT_MS } },
    ) as unknown as Dispatcher
  }

  private cacheKey(proxy: Proxy): string {
    // Identity = full auth URL so a credential change busts the cache; fall back
    // to the dedupe key for the no-auth case.
    return proxy.username !== undefined && proxy.username !== ''
      ? proxyUrl(proxy)
      : proxyDedupeKey(proxy)
  }
}

export type { ProxyProtocol }
export { Agent }
