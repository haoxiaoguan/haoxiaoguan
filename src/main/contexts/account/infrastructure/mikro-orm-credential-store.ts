import type { EntityManager } from '@mikro-orm/better-sqlite'
import { getEm } from '../../../platform/persistence/database'
import { CryptoService, type EnvelopeAad } from '../../../platform/crypto/crypto-service'
import { AccountError } from '../domain/account-error'
import { Credential, type CredentialJson } from '../domain/credential'
import { type PlatformId, platformToAgentId } from '../domain/platform-id'
import type { CredentialStorePort } from '../domain/ports'
import { CredentialRefEntity } from './credential-ref.entity'

// MikroORM-backed credential store — TEMPORARY, owned by the credential context.
//
// Implements the account context's CredentialStorePort by envelope-encrypting
// the credential plaintext (CryptoService AES-256-GCM) and persisting it in the
// `credentials` table. The credential JSON is serialized exactly like the source
// (snake_case Credential fields), then encrypted; the envelope is stored as a
// JSON string in envelope_json. AAD binds {provider, accountId, createdAt} per
// the platform crypto contract.
//
// At integration this is REPLACED by the credential context's own
// CredentialRepository + crypto/kms wiring; the manifest documents the swap.

const KEY_ID = 'local'
const ENVELOPE_VERSION = 1

export class MikroOrmCredentialStore implements CredentialStorePort {
  constructor(
    private readonly crypto: CryptoService,
    private readonly emFactory: () => EntityManager = getEm,
  ) {}

  async store(accountId: string, platform: PlatformId, credential: Credential): Promise<void> {
    const em = this.emFactory()
    try {
      const createdAt = new Date().toISOString()
      const aad: EnvelopeAad = {
        provider: platformToAgentId(platform),
        accountId,
        createdAt,
      }
      const plaintext = JSON.stringify(credential.toJson())
      const envelope = this.crypto.encrypt(plaintext, aad)
      const envelopeJson = JSON.stringify({ aad, envelope })

      let entity = await em.findOne(CredentialRefEntity, { accountId })
      if (entity === null) {
        entity = new CredentialRefEntity()
        entity.accountId = accountId
        em.persist(entity)
      }
      entity.envelopeJson = envelopeJson
      entity.keyId = KEY_ID
      entity.version = ENVELOPE_VERSION
      entity.updatedAt = createdAt
      await em.flush()
    } catch (e) {
      throw AccountError.cryptoError(e instanceof Error ? e.message : String(e))
    }
  }

  async retrieve(accountId: string): Promise<Credential | null> {
    const em = this.emFactory()
    let entity: CredentialRefEntity | null
    try {
      entity = await em.findOne(CredentialRefEntity, { accountId })
    } catch (e) {
      throw AccountError.repositoryError(
        `credential retrieve: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
    if (entity === null) return null
    try {
      const parsed = JSON.parse(entity.envelopeJson) as {
        aad: EnvelopeAad
        envelope: Parameters<CryptoService['decrypt']>[0]
      }
      const plaintext = this.crypto.decrypt(parsed.envelope, parsed.aad)
      const json = JSON.parse(plaintext) as CredentialJson
      return Credential.fromJson(json)
    } catch (e) {
      throw AccountError.cryptoError(e instanceof Error ? e.message : String(e))
    }
  }

  async delete(accountId: string): Promise<void> {
    const em = this.emFactory()
    try {
      await em.nativeDelete(CredentialRefEntity, { accountId })
    } catch (e) {
      throw AccountError.repositoryError(
        `credential delete: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
  }
}
