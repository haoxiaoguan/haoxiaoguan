import type { Dispatcher } from 'undici'
import type { AccountProxyBinding, Proxy, ProxyGroup } from '../domain/proxy'
import type { ProxyDispatcherFactory } from './proxy-dispatcher-factory'

// ProxyResolver — maps an account to the Proxy it should route through, then
// (optionally) to an undici Dispatcher.
//
// Resolution (spec §4):
//   account → binding →
//     group_id  : follow the group's proxy_id
//     proxy_id  : use directly
//     no binding: undefined  (direct connection)
//   a missing proxy/group resolves to undefined (treated as no proxy).

/** The slice of the proxy repository the resolver reads. */
export interface ProxyResolverStore {
  getBinding(accountId: string): Promise<AccountProxyBinding | null>
  getGroup(id: string): Promise<ProxyGroup | null>
  getProxy(id: string): Promise<Proxy | null>
}

export class ProxyResolver {
  constructor(
    private readonly store: ProxyResolverStore,
    private readonly dispatcherFactory?: ProxyDispatcherFactory,
  ) {}

  /** Resolve the bound Proxy (with decrypted password) or undefined. */
  async resolveProxyForAccount(accountId: string): Promise<Proxy | undefined> {
    const binding = await this.store.getBinding(accountId)
    if (binding === null) return undefined

    let proxyId: string | undefined
    if (binding.groupId !== undefined) {
      const group = await this.store.getGroup(binding.groupId)
      proxyId = group?.proxyId
    } else if (binding.proxyId !== undefined) {
      proxyId = binding.proxyId
    }
    if (proxyId === undefined) return undefined

    const proxy = await this.store.getProxy(proxyId)
    return proxy ?? undefined
  }

  /**
   * Resolve the account's proxy to a Dispatcher, or undefined for direct.
   * Requires a dispatcher factory (injected in the real container).
   */
  async dispatcherForAccount(accountId: string): Promise<Dispatcher | undefined> {
    if (this.dispatcherFactory === undefined) return undefined
    const proxy = await this.resolveProxyForAccount(accountId)
    if (proxy === undefined) return undefined
    return this.dispatcherFactory.dispatcherFor(proxy)
  }
}
