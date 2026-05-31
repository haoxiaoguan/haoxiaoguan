import type { EntityManager } from '@mikro-orm/better-sqlite'
import { getEm } from '../../../platform/persistence/database'
import { QuotaError } from '../domain/quota-error'
import type { QuotaStateRepository } from '../domain/ports'
import {
  AccountQuotaState,
  accountQuotaStateFromJson,
  accountQuotaStateToJson,
  type AccountQuotaStateJson,
  type QuotaUnit,
} from '../domain/quota-state'
import { AccountQuotaStateEntity } from './account-quota-state.entity'
import { AccountEntity } from '../../account/infrastructure/account.entity'

// MikroORM implementation of QuotaStateRepository (source SqliteQuotaStateRepository).
//
// save() upserts a single row keyed by account_id. The summary columns mirror
// state.summary(account_id); quota_payload_json holds the sanitised
// AccountQuotaState JSON (camelCase, matching the wire form). On conflict the
// same column list is updated (INSERT OR REPLACE via find-or-create).

function repoErr(prefix: string, e: unknown): QuotaError {
  return QuotaError.repositoryError(`${prefix}: ${e instanceof Error ? e.message : String(e)}`)
}

const UNIT_TO_DB: Record<QuotaUnit, string> = {
  credits: 'credits',
  requests: 'requests',
  tokens: 'tokens',
  usd: 'usd',
  percent: 'percent',
  none: 'none',
}

export class MikroOrmQuotaStateRepository implements QuotaStateRepository {
  constructor(private readonly emFactory: () => EntityManager = getEm) {}

  async get(accountId: string): Promise<AccountQuotaState | null> {
    const em = this.emFactory()
    let entity: AccountQuotaStateEntity | null
    try {
      entity = await em.findOne(AccountQuotaStateEntity, { account: accountId })
    } catch (e) {
      throw repoErr('quota state find', e)
    }
    if (entity === null) return null
    try {
      const json = JSON.parse(entity.quotaPayloadJson) as AccountQuotaStateJson
      return accountQuotaStateFromJson(json)
    } catch (e) {
      throw repoErr('quota state json', e)
    }
  }

  async save(accountId: string, state: AccountQuotaState): Promise<void> {
    const em = this.emFactory()
    const summary = state.summary(accountId)
    let payload: string
    try {
      payload = JSON.stringify(accountQuotaStateToJson(state.sanitized()))
    } catch (e) {
      throw repoErr('quota state serialize', e)
    }

    try {
      await em.transactional(async (tx) => {
        let entity = await tx.findOne(AccountQuotaStateEntity, { account: accountId })
        if (entity === null) {
          entity = new AccountQuotaStateEntity()
          entity.account = tx.getReference(AccountEntity, accountId)
          tx.persist(entity)
        }
        entity.quotaStatus = summary.quotaStatus
        entity.primaryMetricKey = summary.primaryMetricKey ?? null
        entity.primaryLabel = summary.primaryLabel ?? null
        entity.primaryValue = summary.primaryValue ?? null
        entity.primaryPercent = summary.primaryPercent ?? null
        entity.primaryUnit = UNIT_TO_DB[summary.primaryUnit]
        entity.resetAt = summary.resetAt ? summary.resetAt.toISOString() : null
        entity.fetchedAt = summary.fetchedAt ? summary.fetchedAt.toISOString() : null
        entity.quotaPayloadJson = payload
      })
    } catch (e) {
      throw repoErr('quota state save', e)
    }
  }

  async delete(accountId: string): Promise<void> {
    const em = this.emFactory()
    try {
      await em.nativeDelete(AccountQuotaStateEntity, { account: accountId })
    } catch (e) {
      throw repoErr('quota state delete', e)
    }
  }
}
