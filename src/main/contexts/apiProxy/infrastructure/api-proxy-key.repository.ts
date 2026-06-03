import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/better-sqlite'
import { getEm } from '../../../platform/persistence/database'
import { CryptoService } from '../../../platform/crypto/crypto-service'
import { ENVELOPE_VERSION, buildAad, type StoredEnvelope } from '../../credential/domain/envelope'
import { ApiProxyKeyEntity } from './api-proxy-key.entity'

const KEY_ID = 'local'
const AAD_PROVIDER = '__apiproxy_key__'

export interface ApiProxyKeyMeta {
  id: string
  name: string
  keyPrefix: string
  isActive: boolean
  createdAt: string
}

function toMeta(e: ApiProxyKeyEntity): ApiProxyKeyMeta {
  return { id: e.id, name: e.name, keyPrefix: e.keyPrefix, isActive: e.isActive, createdAt: e.createdAt }
}

/** 客户端 Key 加密落库（envelope 范式，同 credential/proxy）。 */
export class ApiProxyKeyRepository {
  constructor(
    private readonly crypto: CryptoService,
    private readonly emFactory: () => EntityManager = getEm,
  ) {}

  async create(name: string, plaintextKey: string): Promise<ApiProxyKeyMeta> {
    const em = this.emFactory()
    const id = randomUUID()
    const createdAt = new Date().toISOString()
    const aad = buildAad(AAD_PROVIDER as never, id, createdAt)
    const envelope = this.crypto.encrypt(plaintextKey, aad)
    const stored: StoredEnvelope = { aad, envelope }
    const entity = new ApiProxyKeyEntity()
    entity.id = id
    entity.name = name
    entity.keyPrefix = plaintextKey.slice(0, 8)
    entity.keyEnc = JSON.stringify(stored)
    entity.keyId = KEY_ID
    entity.version = ENVELOPE_VERSION
    entity.isActive = true
    entity.createdAt = createdAt
    entity.updatedAt = createdAt
    em.persist(entity)
    await em.flush()
    return toMeta(entity)
  }

  async listMeta(): Promise<ApiProxyKeyMeta[]> {
    const em = this.emFactory()
    const rows = await em.find(ApiProxyKeyEntity, {})
    return rows.map(toMeta)
  }

  async listActivePlaintext(): Promise<string[]> {
    const em = this.emFactory()
    const rows = await em.find(ApiProxyKeyEntity, { isActive: true })
    const out: string[] = []
    for (const e of rows) {
      try {
        const stored = JSON.parse(e.keyEnc) as StoredEnvelope
        out.push(this.crypto.decrypt(stored.envelope, stored.aad))
      } catch (err) {
        console.error(`[apiProxy:key] decrypt failed for ${e.id}: ${(err as Error).message}`)
      }
    }
    return out
  }

  async setActive(id: string, isActive: boolean): Promise<void> {
    const em = this.emFactory()
    const e = await em.findOne(ApiProxyKeyEntity, { id })
    if (e === null) return
    e.isActive = isActive
    e.updatedAt = new Date().toISOString()
    await em.flush()
  }

  async delete(id: string): Promise<void> {
    const em = this.emFactory()
    await em.nativeDelete(ApiProxyKeyEntity, { id })
  }
}
