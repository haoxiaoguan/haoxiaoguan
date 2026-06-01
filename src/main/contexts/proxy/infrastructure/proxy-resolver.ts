import type { Dispatcher } from 'undici'
import type { AccountProxyBinding, Proxy } from '../domain/proxy'
import type { ProxyDispatcherFactory } from './proxy-dispatcher-factory'
import type { MikroOrmAccountGroupRepository } from '../../accountGroup/infrastructure/mikro-orm-account-group-repository'

// ProxyResolver — maps an account to the Proxy it should route through, then
// (optionally) to an undici Dispatcher.
//
// Resolution order (most specific wins):
//   1. account_proxy_bindings (per-account proxy) → use proxy_id directly
//   2. the account's group (account_group_proxy_bindings) → the group's proxy_id
//   3. no binding → undefined  (caller treats this as direct connection)
//
// CRITICAL: A missing target proxy resolves to undefined ONLY when the caller
// never asked for routing — i.e. there's no binding row at all. If a per-account
// binding row exists but its referenced proxy was deleted, we return undefined
// WITHOUT falling through to the group (the user explicitly bound that account).
// The "fail loud" guarantee lives at the dispatcher level: decryption failures
// throw, they don't silently fall back.

/** The slice of the proxy repository the resolver reads. */
export interface ProxyResolverStore {
  getBinding(accountId: string): Promise<AccountProxyBinding | null>
  getProxy(id: string): Promise<Proxy | null>
}

/**
 * The slice of the account-group repo the resolver reads. Kept narrow so
 * tests can stub it without dragging in the whole MikroORM repo.
 */
export interface AccountGroupResolverStore {
  /** Groups whose membership contains the account (a single group in practice). */
  listGroupsForAccount(accountId: string): Promise<Array<{ id: string }>>
  /** Per-account-group → proxy binding (or null). */
  getProxyBinding(groupId: string): Promise<{ proxyId?: string } | null>
}

export class ProxyResolver {
  constructor(
    private readonly store: ProxyResolverStore,
    private readonly dispatcherFactory?: ProxyDispatcherFactory,
    private readonly accountGroupStore?: AccountGroupResolverStore,
  ) {}

  /** Resolve the bound Proxy (with decrypted password) or undefined. */
  async resolveProxyForAccount(accountId: string): Promise<Proxy | undefined> {
    const direct = await this.resolveDirectBinding(accountId)
    if (direct !== undefined) return direct.proxy
    if (this.accountGroupStore !== undefined) {
      const groupResolved = await this.resolveAccountGroupBinding(accountId)
      if (groupResolved !== undefined) return groupResolved
    }
    return undefined
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

  // --- private ---

  /**
   * Step 1: per-account binding. Returns:
   *   - { proxy }            the binding resolves to an existing proxy
   *   - { proxy: undefined } sentinel: a binding row exists but its proxy is
   *     gone — caller must NOT fall through to the group (explicit user intent)
   *   - undefined            no per-account binding row at all
   */
  private async resolveDirectBinding(
    accountId: string,
  ): Promise<{ proxy: Proxy | undefined } | undefined> {
    const binding = await this.store.getBinding(accountId)
    if (binding === null) return undefined
    if (binding.proxyId === undefined) return undefined // row with no proxy → treat as no binding
    const proxy = await this.store.getProxy(binding.proxyId)
    return { proxy: proxy ?? undefined }
  }

  /**
   * Step 2: the account's group binding. The first group whose proxy binding
   * resolves wins (in practice an account belongs to at most one group).
   */
  private async resolveAccountGroupBinding(accountId: string): Promise<Proxy | undefined> {
    if (this.accountGroupStore === undefined) return undefined
    const groups = await this.accountGroupStore.listGroupsForAccount(accountId)
    for (const g of groups) {
      const binding = await this.accountGroupStore.getProxyBinding(g.id)
      if (binding === null || binding.proxyId === undefined) continue
      const proxy = await this.store.getProxy(binding.proxyId)
      if (proxy !== null && proxy !== undefined) return proxy
    }
    return undefined
  }
}

/**
 * Adapter wrapping a MikroOrmAccountGroupRepository so it satisfies the narrow
 * AccountGroupResolverStore. Avoids leaking the wider repo into the resolver.
 */
export function asAccountGroupResolverStore(
  repo: MikroOrmAccountGroupRepository,
): AccountGroupResolverStore {
  return {
    async listGroupsForAccount(accountId: string) {
      const groups = await repo.listGroupsForAccount(accountId)
      return groups.map((g) => ({ id: g.id }))
    },
    async getProxyBinding(groupId: string) {
      const b = await repo.getProxyBinding(groupId)
      return b === null ? null : { proxyId: b.proxyId }
    },
  }
}
