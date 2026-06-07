// RelayUpstreamRepository：第三方中转上游的持久化仓储（envelope 加密范式，对齐 api-proxy-key.repository）。
// apiKey 经 CryptoService.encrypt + buildAad 落 key_enc；对外 Record 不含明文 key。
// bytecode 安全：无 class-property 箭头初始化，纯方法。
// 禁：class-property 箭头；禁动态 import()。
import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/better-sqlite'
import { getEm } from '../../../../platform/persistence/database'
import { CryptoService } from '../../../../platform/crypto/crypto-service'
import { buildAad, type StoredEnvelope } from '../../../credential/domain/envelope'
import { RelayUpstreamEntity } from './relay-upstream.entity'
import type { ModelInfo } from '../../domain/platform-adapter'

const AAD_PROVIDER = '__relay_upstream__'

/** 对外暴露的上游记录（不含明文 apiKey）。 */
export interface RelayUpstreamRecord {
  id: string
  displayName: string
  protocol: string
  baseUrl: string
  models: ModelInfo[]
  enabled: boolean
  createdAt: string
  updatedAt: string
  profileId?: string
}

/** 创建上游的输入（含明文 apiKey）。 */
export interface CreateRelayUpstreamInput {
  displayName: string
  protocol: string
  baseUrl: string
  apiKey: string
  models?: ModelInfo[]
  enabled?: boolean
}

/** 更新上游的补丁（可选字段；apiKey 有则重新加密）。 */
export interface UpdateRelayUpstreamPatch {
  displayName?: string
  protocol?: string
  baseUrl?: string
  apiKey?: string
  models?: ModelInfo[]
  enabled?: boolean
}

function toRecord(e: RelayUpstreamEntity): RelayUpstreamRecord {
  const rec: RelayUpstreamRecord = {
    id: e.id,
    displayName: e.displayName,
    protocol: e.protocol,
    baseUrl: e.baseUrl,
    models: e.modelsJson !== null ? (JSON.parse(e.modelsJson) as ModelInfo[]) : [],
    enabled: e.enabled,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  }
  if (e.profileId !== null && e.profileId !== undefined) {
    rec.profileId = e.profileId
  }
  return rec
}

/** 第三方中转上游仓储：CRUD + 解密 apiKey。 */
export class RelayUpstreamRepository {
  constructor(
    private readonly crypto: CryptoService,
    private readonly emFactory: () => EntityManager = getEm,
  ) {}

  async list(): Promise<RelayUpstreamRecord[]> {
    const em = this.emFactory()
    const rows = await em.find(RelayUpstreamEntity, {})
    return rows.map(toRecord)
  }

  async get(id: string): Promise<RelayUpstreamRecord | null> {
    const em = this.emFactory()
    const e = await em.findOne(RelayUpstreamEntity, { id })
    if (e === null) return null
    return toRecord(e)
  }

  async create(input: CreateRelayUpstreamInput): Promise<RelayUpstreamRecord> {
    const em = this.emFactory()
    const id = randomUUID()
    const now = new Date().toISOString()
    const aad = buildAad(AAD_PROVIDER as never, id, now)
    const envelope = this.crypto.encrypt(input.apiKey, aad)
    const stored: StoredEnvelope = { aad, envelope }

    const entity = new RelayUpstreamEntity()
    entity.id = id
    entity.displayName = input.displayName
    entity.protocol = input.protocol
    entity.baseUrl = input.baseUrl
    entity.keyEnc = JSON.stringify(stored)
    entity.modelsJson = input.models !== undefined && input.models.length > 0
      ? JSON.stringify(input.models)
      : null
    entity.enabled = input.enabled ?? true
    entity.createdAt = now
    entity.updatedAt = now
    entity.profileId = null

    em.persist(entity)
    await em.flush()
    return toRecord(entity)
  }

  async update(id: string, patch: UpdateRelayUpstreamPatch): Promise<RelayUpstreamRecord | null> {
    const em = this.emFactory()
    const entity = await em.findOne(RelayUpstreamEntity, { id })
    if (entity === null) return null

    const now = new Date().toISOString()

    if (patch.displayName !== undefined) entity.displayName = patch.displayName
    if (patch.protocol !== undefined) entity.protocol = patch.protocol
    if (patch.baseUrl !== undefined) entity.baseUrl = patch.baseUrl
    if (patch.models !== undefined) {
      entity.modelsJson = patch.models.length > 0 ? JSON.stringify(patch.models) : null
    }
    if (patch.enabled !== undefined) entity.enabled = patch.enabled

    if (patch.apiKey !== undefined) {
      const aad = buildAad(AAD_PROVIDER as never, id, entity.createdAt)
      const envelope = this.crypto.encrypt(patch.apiKey, aad)
      const stored: StoredEnvelope = { aad, envelope }
      entity.keyEnc = JSON.stringify(stored)
    }

    entity.updatedAt = now
    await em.flush()
    return toRecord(entity)
  }

  async delete(id: string): Promise<void> {
    const em = this.emFactory()
    await em.nativeDelete(RelayUpstreamEntity, { id })
  }

  /** 解密并返回明文 apiKey。 */
  async resolveApiKey(id: string): Promise<string> {
    const em = this.emFactory()
    const entity = await em.findOne(RelayUpstreamEntity, { id })
    if (entity === null) throw new Error(`relay upstream not found: ${id}`)
    const stored = JSON.parse(entity.keyEnc) as StoredEnvelope
    return this.crypto.decrypt(stored.envelope, stored.aad)
  }

  /** 按 profileId 查找关联的 relay 上游；不存在返回 null。 */
  async getByProfileId(profileId: string): Promise<RelayUpstreamRecord | null> {
    const em = this.emFactory()
    const e = await em.findOne(RelayUpstreamEntity, { profileId })
    if (e === null) return null
    return toRecord(e)
  }

  /**
   * 按 profileId 建/更上游：存在则 patch，不存在则 create。
   * input 含 displayName/protocol/baseUrl/apiKey/models（同 create 输入）。
   */
  async upsertByProfileId(
    profileId: string,
    input: CreateRelayUpstreamInput,
  ): Promise<RelayUpstreamRecord> {
    const em = this.emFactory()
    const existing = await em.findOne(RelayUpstreamEntity, { profileId })
    if (existing !== null) {
      // update 已有记录
      const now = new Date().toISOString()
      existing.displayName = input.displayName
      existing.protocol = input.protocol
      existing.baseUrl = input.baseUrl
      existing.modelsJson = input.models !== undefined && input.models.length > 0
        ? JSON.stringify(input.models)
        : null
      if (input.enabled !== undefined) existing.enabled = input.enabled
      const aad = buildAad(AAD_PROVIDER as never, existing.id, existing.createdAt)
      const envelope = this.crypto.encrypt(input.apiKey, aad)
      const stored: StoredEnvelope = { aad, envelope }
      existing.keyEnc = JSON.stringify(stored)
      existing.updatedAt = now
      await em.flush()
      return toRecord(existing)
    }

    // create 新记录，并绑定 profileId
    const id = randomUUID()
    const now = new Date().toISOString()
    const aad = buildAad(AAD_PROVIDER as never, id, now)
    const envelope = this.crypto.encrypt(input.apiKey, aad)
    const stored: StoredEnvelope = { aad, envelope }

    const entity = new RelayUpstreamEntity()
    entity.id = id
    entity.displayName = input.displayName
    entity.protocol = input.protocol
    entity.baseUrl = input.baseUrl
    entity.keyEnc = JSON.stringify(stored)
    entity.modelsJson = input.models !== undefined && input.models.length > 0
      ? JSON.stringify(input.models)
      : null
    entity.enabled = input.enabled ?? true
    entity.createdAt = now
    entity.updatedAt = now
    entity.profileId = profileId

    em.persist(entity)
    await em.flush()
    return toRecord(entity)
  }

  /** 按 profileId 删除关联的 relay 上游（不存在则静默跳过）。 */
  async deleteByProfileId(profileId: string): Promise<void> {
    const em = this.emFactory()
    await em.nativeDelete(RelayUpstreamEntity, { profileId })
  }
}
