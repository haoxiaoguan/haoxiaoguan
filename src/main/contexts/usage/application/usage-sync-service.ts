/**
 * UsageSyncService — ETL from local agent log files into usage_records.
 * Mirrors Rust UsageSyncService.sync_all().
 *
 * Iterates all agents with session_log capability, calls readUsageMetrics(null),
 * upserts the batch. Tracks per-agent errors in lastErrors (single-threaded in
 * Node so no Mutex needed, but the pattern is preserved for the command handler).
 */
import type { AgentRegistry } from '../../../agents/shared/session-log-reader'
import type { UsageRecordRepository } from '../domain/usage-repositories'
import type { UsageSyncSummary } from '../domain/usage-record'

export class UsageSyncService {
  private _lastErrors: string[] = []

  constructor(
    private readonly agentRegistry: AgentRegistry,
    private readonly recordRepo: UsageRecordRepository,
  ) {}

  async syncAll(): Promise<UsageSyncSummary> {
    this._lastErrors = []

    const summary: UsageSyncSummary = { imported: 0, failed: 0, platforms: [] }
    const errors: string[] = []

    const agents = this.agentRegistry.listByCapability('session_log')

    for (const agent of agents) {
      const reader = agent.asSessionLogReader()
      if (!reader) continue

      const agentName = agent.id()
      try {
        const batch = await reader.readUsageMetrics(null)
        const imported = await this.recordRepo.upsertMany(batch.records)
        summary.imported += imported
        summary.platforms.push(agentName)
      } catch (err) {
        summary.failed += 1
        errors.push(`${agentName}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    this._lastErrors = errors

    if (summary.platforms.length === 0 && errors.length > 0) {
      throw new Error(errors.join('; '))
    }

    return summary
  }

  /** Returns errors from the most recent syncAll() call. */
  lastErrors(): string[] {
    return [...this._lastErrors]
  }
}
