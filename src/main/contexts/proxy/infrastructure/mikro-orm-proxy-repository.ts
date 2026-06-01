import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/better-sqlite'
import { getEm } from '../../../platform/persistence/database'
import { CryptoService } from '../../../platform/crypto/crypto-service'
import type { EnvelopeAad } from '../../credential/domain/envelope'
import type { StoredEnvelope } from '../../credential/domain/envelope'
import {
  proxyDedupeKey,
  type Proxy,
  type ProxyCheckResult,
  type ProxyGroup,
  type AccountProxyBinding,
  type ProxyProtocol,
  type ProxyStatus,
} from '../domain/proxy'
import { ProxyError } from '../domain/proxy-error'
import { ProxyEntity } from './proxy.entity'
import { ProxyGroupEntity } from './proxy-group.entity'
import { AccountProxyBindingEntity } from './account-proxy-binding.entity'

// MikroORM-backed proxy repository. Encrypts the proxy password with the shared
// CryptoService (same AES-256-GCM envelope as credentials), persisting the
// JSON-stringified StoredEnvelope in proxies.password_enc — NEVER plaintext.
//
// The AAD binds ciphertext to {provider:'__proxy__', accountId: proxyId,
// createdAt}; proxies aren't account-scoped so the proxy id stands in for the
// accountId slot. createdAt is stored alongside (it is part of the AAD) so the
// envelope round-trips.

const PROXY_AAD_PROVIDER = '__proxy__'

export interface CreateProxyInput {
  label?: string
  protocol: ProxyProtocol
  host: string
  port: number
  username?: string
  password?: string
  tags: string[]
}

export interface UpdateProxyInput {
  label?: string
  protocol?: ProxyProtocol
  host?: string
  port?: number
  username?: string
  /** undefined = leave unchanged; '' or a string = set/replace; null = clear. */
  password?: string | null
  tags?: string[]
}

export class MikroOrmProxyRepository {
  constructor(
    private readonly crypto: CryptoService,
    private readonly emFactory: () => EntityManager = getEm,
  ) {}

  // --- proxies ---

  async createProxy(input: CreateProxyInput): Promise<Proxy> {
    const em = this.emFactory()
    try {
      const id = randomUUID()
      const createdAt = new Date().toISOString()
      const entity = new ProxyEntity()
      entity.id = id
      entity.label = input.label ?? null
      entity.protocol = input.protocol
      entity.host = input.host
      entity.port = input.port
      entity.username = input.username ?? null
      entity.passwordEnc = this.encryptPassword(input.password, id, createdAt)
      entity.status = 'unknown'
      entity.tagsJson = JSON.stringify(input.tags ?? [])
      entity.dedupeKey = proxyDedupeKey(input)
      entity.createdAt = createdAt
      em.persist(entity)
      await em.flush()
      return this.toProxy(entity)
    } catch (e) {
      throw this.wrapStorage('createProxy', e)
    }
  }

  async getProxy(id: string): Promise<Proxy | null> {
    const em = this.emFactory()
    const entity = await em.findOne(ProxyEntity, { id })
    return entity === null ? null : this.toProxy(entity)
  }

  async listProxies(): Promise<Proxy[]> {
    const em = this.emFactory()
    const rows = await em.find(ProxyEntity, {}, { orderBy: { createdAt: 'asc' } })
    return rows.map((e) => this.toProxy(e))
  }

  async findByDedupeKey(key: string): Promise<Proxy | null> {
    const em = this.emFactory()
    const entity = await em.findOne(ProxyEntity, { dedupeKey: key })
    return entity === null ? null : this.toProxy(entity)
  }

  async updateProxy(id: string, patch: UpdateProxyInput): Promise<Proxy> {
    const em = this.emFactory()
    const entity = await em.findOne(ProxyEntity, { id })
    if (entity === null) throw ProxyError.notFound(id)
    try {
      if (patch.label !== undefined) entity.label = patch.label
      if (patch.protocol !== undefined) entity.protocol = patch.protocol
      if (patch.host !== undefined) entity.host = patch.host
      if (patch.port !== undefined) entity.port = patch.port
      if (patch.username !== undefined) entity.username = patch.username
      if (patch.password !== undefined) {
        entity.passwordEnc =
          patch.password === null
            ? null
            : this.encryptPassword(patch.password, id, entity.createdAt)
      }
      if (patch.tags !== undefined) entity.tagsJson = JSON.stringify(patch.tags)
      // keep the dedupe key consistent with any identity changes
      entity.dedupeKey = proxyDedupeKey({
        protocol: entity.protocol as ProxyProtocol,
        host: entity.host,
        port: entity.port,
        username: entity.username ?? undefined,
      })
      await em.flush()
      return this.toProxy(entity)
    } catch (e) {
      throw this.wrapStorage('updateProxy', e)
    }
  }

  async deleteProxy(id: string): Promise<void> {
    const em = this.emFactory()
    try {
      await em.nativeDelete(ProxyEntity, { id })
    } catch (e) {
      throw this.wrapStorage('deleteProxy', e)
    }
  }

  async recordCheck(id: string, result: ProxyCheckResult): Promise<void> {
    const em = this.emFactory()
    const entity = await em.findOne(ProxyEntity, { id })
    if (entity === null) throw ProxyError.notFound(id)
    entity.status = result.status
    entity.lastEgressIp = result.egressIp ?? null
    entity.lastLatencyMs = result.latencyMs ?? null
    entity.lastError = result.error ?? null
    entity.lastCheckedAt = result.checkedAt.toISOString()
    await em.flush()
  }

  // --- groups ---

  async createGroup(name: string, proxyId: string): Promise<ProxyGroup> {
    const em = this.emFactory()
    const entity = new ProxyGroupEntity()
    entity.id = randomUUID()
    entity.name = name
    entity.proxyId = proxyId
    entity.createdAt = new Date().toISOString()
    em.persist(entity)
    await em.flush()
    return this.toGroup(entity)
  }

  async listGroups(): Promise<ProxyGroup[]> {
    const em = this.emFactory()
    const rows = await em.find(ProxyGroupEntity, {}, { orderBy: { createdAt: 'asc' } })
    return rows.map((e) => this.toGroup(e))
  }

  async getGroup(id: string): Promise<ProxyGroup | null> {
    const em = this.emFactory()
    const entity = await em.findOne(ProxyGroupEntity, { id })
    return entity === null ? null : this.toGroup(entity)
  }

  async deleteGroup(id: string): Promise<void> {
    const em = this.emFactory()
    await em.nativeDelete(ProxyGroupEntity, { id })
  }

  // --- bindings ---

  async bindAccount(
    accountId: string,
    target: { proxyId?: string; groupId?: string },
  ): Promise<void> {
    const em = this.emFactory()
    let entity = await em.findOne(AccountProxyBindingEntity, { accountId })
    if (entity === null) {
      entity = new AccountProxyBindingEntity()
      entity.accountId = accountId
      entity.createdAt = new Date().toISOString()
      em.persist(entity)
    }
    entity.proxyId = target.proxyId ?? null
    entity.groupId = target.groupId ?? null
    await em.flush()
  }

  async unbindAccount(accountId: string): Promise<void> {
    const em = this.emFactory()
    await em.nativeDelete(AccountProxyBindingEntity, { accountId })
  }

  async getBinding(accountId: string): Promise<AccountProxyBinding | null> {
    const em = this.emFactory()
    const entity = await em.findOne(AccountProxyBindingEntity, { accountId })
    return entity === null ? null : this.toBinding(entity)
  }

  async listBindings(): Promise<AccountProxyBinding[]> {
    const em = this.emFactory()
    const rows = await em.find(AccountProxyBindingEntity, {})
    return rows.map((e) => this.toBinding(e))
  }

  async countAccountsForProxy(proxyId: string): Promise<number> {
    const em = this.emFactory()
    return em.count(AccountProxyBindingEntity, { proxyId })
  }

  async countGroupsForProxy(proxyId: string): Promise<number> {
    const em = this.emFactory()
    return em.count(ProxyGroupEntity, { proxyId })
  }

  async countAccountsForGroup(groupId: string): Promise<number> {
    const em = this.emFactory()
    return em.count(AccountProxyBindingEntity, { groupId })
  }

  // --- mapping + crypto helpers ---

  private buildAad(proxyId: string, createdAt: string): EnvelopeAad {
    return { provider: PROXY_AAD_PROVIDER, accountId: proxyId, createdAt }
  }

  private encryptPassword(
    password: string | undefined,
    proxyId: string,
    createdAt: string,
  ): string | null {
    if (password === undefined || password === '') return null
    const aad = this.buildAad(proxyId, createdAt)
    const envelope = this.crypto.encrypt(password, aad)
    const stored: StoredEnvelope = { aad, envelope }
    return JSON.stringify(stored)
  }

  private decryptPassword(passwordEnc: string | null | undefined): string | undefined {
    if (passwordEnc === null || passwordEnc === undefined || passwordEnc === '') return undefined
    try {
      const stored = JSON.parse(passwordEnc) as StoredEnvelope
      return this.crypto.decrypt(stored.envelope, stored.aad)
    } catch (e) {
      throw ProxyError.internal(`password decrypt: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  private toProxy(e: ProxyEntity): Proxy {
    return {
      id: e.id,
      label: e.label ?? undefined,
      protocol: e.protocol as ProxyProtocol,
      host: e.host,
      port: e.port,
      username: e.username ?? undefined,
      password: this.decryptPassword(e.passwordEnc),
      status: e.status as ProxyStatus,
      lastEgressIp: e.lastEgressIp ?? undefined,
      lastLatencyMs: e.lastLatencyMs ?? undefined,
      lastCheckedAt: e.lastCheckedAt ? new Date(e.lastCheckedAt) : undefined,
      tags: this.parseTags(e.tagsJson),
      createdAt: new Date(e.createdAt),
    }
  }

  private toGroup(e: ProxyGroupEntity): ProxyGroup {
    return { id: e.id, name: e.name, proxyId: e.proxyId, createdAt: new Date(e.createdAt) }
  }

  private toBinding(e: AccountProxyBindingEntity): AccountProxyBinding {
    return {
      accountId: e.accountId,
      proxyId: e.proxyId ?? undefined,
      groupId: e.groupId ?? undefined,
      createdAt: new Date(e.createdAt),
    }
  }

  private parseTags(json: string): string[] {
    try {
      const parsed = JSON.parse(json) as unknown
      return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : []
    } catch {
      return []
    }
  }

  private wrapStorage(op: string, e: unknown): ProxyError {
    if (e instanceof ProxyError) return e
    return ProxyError.storageError(`${op}: ${e instanceof Error ? e.message : String(e)}`)
  }
}
