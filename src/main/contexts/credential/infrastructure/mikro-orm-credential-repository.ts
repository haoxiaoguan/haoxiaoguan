import type { EntityManager } from '@mikro-orm/better-sqlite'
import { getEm } from '../../../platform/persistence/database'
import { CryptoService } from '../../../platform/crypto/crypto-service'
import type { CredentialStorePort } from '../../account/domain/ports'
import { type PlatformId } from '../../account/domain/platform-id'
import { Credential, type CredentialJson } from '../domain/credential'
import { CredentialError } from '../domain/credential-error'
import type { CredentialRepository } from '../domain/credential-repository'
import { ENVELOPE_VERSION, buildAad, type StoredEnvelope } from '../domain/envelope'
import { CredentialEntity } from './credential.entity'

// MikroORM-backed CredentialRepository — the authoritative credential store.
//
// Envelope-encrypts the credential plaintext with the platform CryptoService
// (AES-256-GCM, JSON AAD of {provider, accountId, createdAt}) and persists it as
// a JSON string in credentials.envelope_json. The wrapper shape
// `{ aad, envelope }` is identical to the account context's TEMP
// MikroOrmCredentialStore, so this is a drop-in replacement that also implements
// the account `CredentialStorePort` interface.
//
// On read, both shapes are handled: the current `{ aad, envelope }` wrapper and
// a defensive fallback. No legacy envelope formats are supported (no data-compat
// requirement per spec §5.2 — fresh schema, fresh master key).

const KEY_ID = 'local'

export class MikroOrmCredentialRepository implements CredentialRepository, CredentialStorePort {
  constructor(
    private readonly crypto: CryptoService,
    private readonly emFactory: () => EntityManager = getEm,
  ) {}

  async store(accountId: string, platform: PlatformId, credential: Credential): Promise<void> {
    const em = this.emFactory()
    try {
      const createdAt = new Date().toISOString()
      const aad = buildAad(platform, accountId, createdAt)
      const plaintext = JSON.stringify(credential.toJson())
      const envelope = this.crypto.encrypt(plaintext, aad)
      const stored: StoredEnvelope = { aad, envelope }
      const envelopeJson = JSON.stringify(stored)

      let entity = await em.findOne(CredentialEntity, { accountId })
      if (entity === null) {
        entity = new CredentialEntity()
        entity.accountId = accountId
        em.persist(entity)
      }
      entity.envelopeJson = envelopeJson
      entity.keyId = KEY_ID
      entity.version = ENVELOPE_VERSION
      entity.updatedAt = createdAt
      await em.flush()
    } catch (e) {
      throw CredentialError.storageError(e instanceof Error ? e.message : String(e))
    }
  }

  async retrieve(accountId: string): Promise<Credential | null> {
    const stored = await this.loadEnvelope(accountId)
    if (!stored) return null
    try {
      const plaintext = this.crypto.decrypt(stored.envelope, stored.aad)
      const json = JSON.parse(plaintext) as CredentialJson
      return Credential.fromJson(json)
    } catch (e) {
      throw CredentialError.internal(`crypto: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  async loadEnvelope(accountId: string): Promise<StoredEnvelope | null> {
    const em = this.emFactory()
    let entity: CredentialEntity | null
    try {
      entity = await em.findOne(CredentialEntity, { accountId })
    } catch (e) {
      throw CredentialError.storageError(
        `credential retrieve: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
    if (entity === null || entity.envelopeJson === '') return null
    try {
      return JSON.parse(entity.envelopeJson) as StoredEnvelope
    } catch (e) {
      throw CredentialError.internal(`envelope parse: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  async delete(accountId: string): Promise<void> {
    const em = this.emFactory()
    try {
      await em.nativeDelete(CredentialEntity, { accountId })
    } catch (e) {
      throw CredentialError.storageError(
        `credential delete: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
  }
}
