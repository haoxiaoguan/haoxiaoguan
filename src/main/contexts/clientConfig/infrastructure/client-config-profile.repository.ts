// 接入档 MikroORM 仓储（ClientConfigStore 实现）。第三方明文 key 走 envelope 加密落 key_enc。
import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/better-sqlite'
import { getEm } from '../../../platform/persistence/database'
import { CryptoService } from '../../../platform/crypto/crypto-service'
import { buildAad, type StoredEnvelope } from '../../credential/domain/envelope'
import { ClientConfigProfileEntity } from './client-config-profile.entity'
import type { ClientId, ClientConfigProfile, ProfileSource } from '../domain/client-profile'
import type {
  ClientConfigStore,
  CreateProfileInput,
  UpdateProfileInput,
} from '../application/client-config-store'

const AAD_PROVIDER = '__clientconfig_key__'

function toProfile(e: ClientConfigProfileEntity): ClientConfigProfile {
  return {
    id: e.id,
    clientId: e.clientId as ClientId,
    name: e.name,
    source: e.source as ProfileSource,
    baseUrl: e.baseUrl,
    ...(e.model != null ? { model: e.model } : {}),
    isCurrent: e.isCurrent,
    sortIndex: e.sortIndex,
    createdAt: Date.parse(e.createdAt),
    updatedAt: Date.parse(e.updatedAt),
    ...(e.notes != null ? { notes: e.notes } : {}),
  }
}

export class ClientConfigProfileRepository implements ClientConfigStore {
  private readonly crypto: CryptoService
  private readonly emFactory: () => EntityManager

  constructor(crypto: CryptoService, emFactory: () => EntityManager = getEm) {
    this.crypto = crypto
    this.emFactory = emFactory
  }

  async list(clientId?: ClientId): Promise<ClientConfigProfile[]> {
    const em = this.emFactory()
    const where = clientId !== undefined ? { clientId } : {}
    const rows = await em.find(ClientConfigProfileEntity, where, { orderBy: { sortIndex: 'asc' } })
    return rows.map(toProfile)
  }

  async get(id: string): Promise<ClientConfigProfile | null> {
    const em = this.emFactory()
    const e = await em.findOne(ClientConfigProfileEntity, { id })
    return e === null ? null : toProfile(e)
  }

  async create(input: CreateProfileInput): Promise<ClientConfigProfile> {
    const em = this.emFactory()
    const id = randomUUID()
    const now = new Date().toISOString()
    const existing = await em.find(ClientConfigProfileEntity, { clientId: input.clientId })
    const e = new ClientConfigProfileEntity()
    e.id = id
    e.clientId = input.clientId
    e.name = input.name
    e.source = input.source
    e.baseUrl = input.baseUrl
    if (input.model !== undefined) e.model = input.model
    if (input.apiKey !== undefined && input.apiKey.length > 0) e.keyEnc = this.encryptKey(id, now, input.apiKey)
    if (input.keyRef !== undefined) e.keyRef = input.keyRef
    e.isCurrent = false
    e.sortIndex = existing.length
    e.createdAt = now
    e.updatedAt = now
    if (input.notes !== undefined) e.notes = input.notes
    em.persist(e)
    await em.flush()
    return toProfile(e)
  }

  async update(id: string, patch: UpdateProfileInput): Promise<void> {
    const em = this.emFactory()
    const e = await em.findOne(ClientConfigProfileEntity, { id })
    if (e === null) return
    if (patch.name !== undefined) e.name = patch.name
    if (patch.baseUrl !== undefined) e.baseUrl = patch.baseUrl
    if (patch.model !== undefined) e.model = patch.model === null ? undefined : patch.model
    if (patch.notes !== undefined) e.notes = patch.notes === null ? undefined : patch.notes
    if (patch.apiKey !== undefined && patch.apiKey.length > 0) e.keyEnc = this.encryptKey(e.id, e.createdAt, patch.apiKey)
    e.updatedAt = new Date().toISOString()
    await em.flush()
  }

  async delete(id: string): Promise<void> {
    const em = this.emFactory()
    await em.nativeDelete(ClientConfigProfileEntity, { id })
  }

  async setCurrent(clientId: ClientId, id: string): Promise<void> {
    const em = this.emFactory()
    const rows = await em.find(ClientConfigProfileEntity, { clientId })
    for (const e of rows) e.isCurrent = e.id === id
    await em.flush()
  }

  async resolveApiKey(id: string): Promise<string> {
    const em = this.emFactory()
    const e = await em.findOne(ClientConfigProfileEntity, { id })
    if (e === null) throw new Error(`接入档不存在: ${id}`)
    if (e.keyEnc != null && e.keyEnc.length > 0) {
      const stored = JSON.parse(e.keyEnc) as StoredEnvelope
      return this.crypto.decrypt(stored.envelope, stored.aad)
    }
    if (e.keyRef != null && e.keyRef.length > 0) {
      // local-proxy：解析反代 client key 表的明文留待 phase3（接入 ApiProxyKeyService）。
      throw new Error('local-proxy key 解析待 phase3 接入')
    }
    return ''
  }

  private encryptKey(id: string, createdAt: string, plaintext: string): string {
    const aad = buildAad(AAD_PROVIDER as never, id, createdAt)
    const envelope = this.crypto.encrypt(plaintext, aad)
    const stored: StoredEnvelope = { aad, envelope }
    return JSON.stringify(stored)
  }
}
