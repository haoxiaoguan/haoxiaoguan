import type { EntityManager } from '@mikro-orm/better-sqlite'
import { getEm } from '../../../platform/persistence/database'
import { QuotaError } from '../domain/quota-error'
import { ModelQuota, QuotaInfo } from '../domain/quota'
import type { QuotaCacheRepository } from '../domain/ports'
import { QuotaCacheEntity } from './quota-cache.entity'
import { AccountEntity } from '../../account/infrastructure/account.entity'

// MikroORM implementation of QuotaCacheRepository (source SqliteQuotaCacheRepository).
//
// save() deletes all rows for the account, then re-inserts one row per model,
// wrapped in a transaction (the source did delete + insert without a tx; the
// migration convention asks us to wrap it so we never leave partial state on a
// failed insert — see manifest porting notes). Empty models list inserts nothing
// (so get() returns null afterwards, matching source semantics). Timestamps are
// RFC3339 strings; fetched_at is taken from the first row on read.

function repoErr(prefix: string, e: unknown): QuotaError {
  return QuotaError.repositoryError(`${prefix}: ${e instanceof Error ? e.message : String(e)}`)
}

export class MikroOrmQuotaCacheRepository implements QuotaCacheRepository {
  constructor(private readonly emFactory: () => EntityManager = getEm) {}

  async get(accountId: string): Promise<QuotaInfo | null> {
    const em = this.emFactory()
    try {
      const rows = await em.find(QuotaCacheEntity, { account: accountId })
      if (rows.length === 0) return null

      const models: ModelQuota[] = []
      let fetchedAt: Date | undefined
      for (const row of rows) {
        const resetAt = row.resetAt != null ? new Date(row.resetAt) : undefined
        if (fetchedAt === undefined) fetchedAt = new Date(row.fetchedAt)
        models.push(new ModelQuota(row.model, row.used, row.total, resetAt))
      }
      return new QuotaInfo(accountId, models, fetchedAt ?? new Date())
    } catch (e) {
      throw repoErr('quota find', e)
    }
  }

  async save(quota: QuotaInfo): Promise<void> {
    const em = this.emFactory()
    const accountId = quota.accountId
    const fetchedAt = quota.fetchedAt.toISOString()
    try {
      await em.transactional(async (tx) => {
        await tx.nativeDelete(QuotaCacheEntity, { account: accountId })
        if (quota.models.length === 0) return
        const accountRef = tx.getReference(AccountEntity, accountId)
        for (const model of quota.models) {
          const entity = new QuotaCacheEntity()
          entity.account = accountRef
          entity.model = model.modelName
          entity.used = model.used
          entity.total = model.total
          entity.resetAt = model.resetAt ? model.resetAt.toISOString() : null
          entity.fetchedAt = fetchedAt
          tx.persist(entity)
        }
      })
    } catch (e) {
      throw repoErr('quota save', e)
    }
  }

  async delete(accountId: string): Promise<void> {
    const em = this.emFactory()
    try {
      await em.nativeDelete(QuotaCacheEntity, { account: accountId })
    } catch (e) {
      throw repoErr('quota delete', e)
    }
  }
}
