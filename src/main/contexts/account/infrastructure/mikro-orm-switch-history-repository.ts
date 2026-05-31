import type { EntityManager } from '@mikro-orm/better-sqlite'
import { getEm } from '../../../platform/persistence/database'
import { AccountError } from '../domain/account-error'
import {
  type PlatformId,
  platformToAgentId,
  platformFromAgentIdOrCursor,
} from '../domain/platform-id'
import type { SwitchHistoryEntry, TriggerType } from '../domain/switch-history'
import type { SwitchHistoryRepository } from '../domain/switch-history-repository'
import { SwitchHistoryEntity } from './switch-history.entity'

function triggerToString(t: TriggerType): string {
  return t
}

function triggerFromString(s: string): TriggerType {
  switch (s) {
    case 'manual':
    case 'auto':
    case 'websocket':
      return s
    default:
      throw AccountError.repositoryError(`trigger parse: ${s}`)
  }
}

/**
 * MikroORM implementation of SwitchHistoryRepository (source
 * SqliteSwitchHistoryRepository). Append-only; find_recent orders by
 * switched_at DESC with a limit.
 */
export class MikroOrmSwitchHistoryRepository implements SwitchHistoryRepository {
  constructor(private readonly emFactory: () => EntityManager = getEm) {}

  async record(entry: SwitchHistoryEntry): Promise<void> {
    const em = this.emFactory()
    try {
      const row = new SwitchHistoryEntity()
      row.accountId = entry.accountId
      row.agentId = platformToAgentId(entry.agentId)
      row.triggerType = triggerToString(entry.triggerType)
      row.success = entry.success
      row.errorMessage = entry.errorMessage ?? null
      row.switchedAt = entry.switchedAt.toISOString()
      await em.persistAndFlush(row)
    } catch (e) {
      throw AccountError.repositoryError(`switch insert: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  async findRecent(limit: number): Promise<SwitchHistoryEntry[]> {
    const em = this.emFactory()
    try {
      const rows = await em.find(
        SwitchHistoryEntity,
        {},
        { orderBy: { switchedAt: 'desc' }, limit },
      )
      return rows.map((m) => ({
        accountId: m.accountId,
        agentId: platformFromAgentIdOrCursor(m.agentId) as PlatformId,
        triggerType: triggerFromString(m.triggerType),
        success: m.success,
        errorMessage: m.errorMessage ?? undefined,
        switchedAt: new Date(m.switchedAt),
      }))
    } catch (e) {
      throw AccountError.repositoryError(`switch list: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
}
