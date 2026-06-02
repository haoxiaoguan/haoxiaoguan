import type { EntityManager } from '@mikro-orm/better-sqlite'
import { getEm } from '../../../platform/persistence/database'
import { Account } from '../domain/account'
import { AccountError } from '../domain/account-error'
import { AccountName } from '../domain/account-name'
import { Notes } from '../domain/notes'
import { Tags } from '../domain/tags'
import type { JsonValue } from '../domain/platform-account-profile'
import type { AccountRepository } from '../domain/account-repository'
import {
  type PlatformId,
  platformToAgentId,
} from '../domain/platform-id'
import { AccountEntity } from './account.entity'
import { AccountTagEntity } from './account-tag.entity'

function normalizeIdentityKey(value: string): string {
  return value.trim().toLowerCase()
}

function parseProfilePayload(json: string): JsonValue {
  try {
    return JSON.parse(json) as JsonValue
  } catch {
    return {}
  }
}

/**
 * MikroORM implementation of AccountRepository.
 *
 * Write path uses a transaction: upsert the accounts row + replace account_tags
 * wholesale (delete-then-insert). Reads reconstruct the Account aggregate via
 * Account.reconstruct (bypassing validation, since data was validated on write).
 */
export class MikroOrmAccountRepository implements AccountRepository {
  // emFactory lets tests inject a forked EM; defaults to platform getEm().
  constructor(private readonly emFactory: () => EntityManager = getEm) {}

  private async loadTags(em: EntityManager, accountId: string): Promise<string[]> {
    const rows = await em.find(AccountTagEntity, { account: accountId })
    return rows.map((r) => r.tag)
  }

  private async modelToAccount(em: EntityManager, m: AccountEntity): Promise<Account> {
    const tagsVec = await this.loadTags(em, m.id)
    const name = m.name != null ? AccountName.create(m.name) : undefined
    const notes = m.notes != null ? Notes.create(m.notes) : undefined
    const tags = Tags.create(tagsVec)
    const createdAt = new Date(m.createdAt)
    const lastUsedAt = m.lastUsedAt != null ? new Date(m.lastUsedAt) : undefined
    return Account.reconstruct({
      id: m.id,
      agentId: m.agentId,
      email: m.email,
      identityKey: m.identityKey,
      displayIdentifier: m.displayIdentifier,
      name,
      loginProvider: m.loginProvider ?? undefined,
      planName: m.planName ?? undefined,
      planTier: m.planTier ?? undefined,
      status: m.status ?? undefined,
      statusReason: m.statusReason ?? undefined,
      profilePayload: parseProfilePayload(m.profilePayloadJson),
      tags,
      notes,
      isActive: m.isActive,
      createdAt,
      lastUsedAt,
    })
  }

  async findById(id: string): Promise<Account | null> {
    const em = this.emFactory()
    try {
      const m = await em.findOne(AccountEntity, { id })
      return m ? await this.modelToAccount(em, m) : null
    } catch (e) {
      throw AccountError.repositoryError(`account find: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  async findByPlatform(platform: PlatformId): Promise<Account[]> {
    const em = this.emFactory()
    try {
      const rows = await em.find(AccountEntity, { agentId: platformToAgentId(platform) })
      const out: Account[] = []
      for (const m of rows) out.push(await this.modelToAccount(em, m))
      return out
    } catch (e) {
      throw AccountError.repositoryError(`account list: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  async findActiveByPlatform(platform: PlatformId): Promise<Account | null> {
    const em = this.emFactory()
    try {
      const m = await em.findOne(AccountEntity, {
        agentId: platformToAgentId(platform),
        isActive: true,
      })
      return m ? await this.modelToAccount(em, m) : null
    } catch (e) {
      throw AccountError.repositoryError(`account active: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  async findByTags(tags: string[]): Promise<Account[]> {
    if (tags.length === 0) return []
    const em = this.emFactory()
    try {
      const tagRows = await em.find(AccountTagEntity, { tag: { $in: tags } }, { populate: ['account'] })
      const seen = new Set<string>()
      const out: Account[] = []
      for (const tagRow of tagRows) {
        const accountId = tagRow.account.id
        if (seen.has(accountId)) continue
        seen.add(accountId)
        const m = await em.findOne(AccountEntity, { id: accountId })
        if (m) out.push(await this.modelToAccount(em, m))
      }
      return out
    } catch (e) {
      throw AccountError.repositoryError(`account by tags: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  async save(account: Account): Promise<void> {
    const em = this.emFactory()
    const idStr = account.id
    let profilePayloadJson: string
    try {
      profilePayloadJson = JSON.stringify(account.profilePayload)
    } catch (e) {
      throw AccountError.repositoryError(
        `profile payload serialize: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
    const tagsVec = [...account.tags.asSlice()]

    try {
      await em.transactional(async (tx) => {
        // upsert accounts row (INSERT OR REPLACE equivalent).
        let entity = await tx.findOne(AccountEntity, { id: idStr })
        if (entity === null) {
          entity = new AccountEntity()
          entity.id = idStr
          tx.persist(entity)
        }
        entity.agentId = account.agentId
        entity.email = account.email
        entity.identityKey = account.identityKey
        entity.displayIdentifier = account.displayIdentifier
        entity.name = account.name?.asStr() ?? null
        entity.loginProvider = account.loginProvider ?? null
        entity.planName = account.planName ?? null
        entity.planTier = account.planTier ?? null
        entity.status = account.status ?? null
        entity.statusReason = account.statusReason ?? null
        entity.profilePayloadJson = profilePayloadJson
        entity.notes = account.notes?.asStr() ?? null
        entity.isActive = account.isActive
        entity.createdAt = account.createdAt.toISOString()
        entity.lastUsedAt = account.lastUsedAt ? account.lastUsedAt.toISOString() : null

        // tags: delete-then-insert.
        await tx.nativeDelete(AccountTagEntity, { account: idStr })
        for (const tag of tagsVec) {
          const tagEntity = new AccountTagEntity()
          tagEntity.account = entity
          tagEntity.tag = tag
          tx.persist(tagEntity)
        }
      })
    } catch (e) {
      throw AccountError.repositoryError(`account upsert: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  async delete(id: string): Promise<void> {
    const em = this.emFactory()
    try {
      await em.transactional(async (tx) => {
        // Explicit tag delete (schema also cascades, but be explicit like source).
        await tx.nativeDelete(AccountTagEntity, { account: id })
        await tx.nativeDelete(AccountEntity, { id })
      })
    } catch (e) {
      throw AccountError.repositoryError(`account delete: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  async existsByIdentifier(platform: PlatformId, identity: string): Promise<boolean> {
    const em = this.emFactory()
    try {
      const count = await em.count(AccountEntity, {
        agentId: platformToAgentId(platform),
        identityKey: normalizeIdentityKey(identity),
      })
      return count > 0
    } catch (e) {
      throw AccountError.repositoryError(`account exists: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
}
