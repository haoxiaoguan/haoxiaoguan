/**
 * UsageSyncService — ETL from local agent log files into usage_records.
 * Mirrors Rust UsageSyncService.sync_all().
 *
 * Iterates all agents with session_log capability, calls readUsageMetrics(null),
 * upserts the batch. Tracks per-agent errors in lastErrors (single-threaded in
 * Node so no Mutex needed, but the pattern is preserved for the command handler).
 */
import type { AgentRegistry } from '../../../agents/shared/session-log-reader'
import type { UsageFileCursorStore } from '../../../agents/shared/usage-file-cursor-store'
import type { UsageRecordRepository } from '../domain/usage-repositories'
import type { UsageSyncSummary } from '../domain/usage-record'
import type { UsageEventIngestService } from '../../analytics/application/usage-event-ingest-service'

export class UsageSyncService {
  private _lastErrors: string[] = []

  constructor(
    private readonly agentRegistry: AgentRegistry,
    private readonly recordRepo: UsageRecordRepository,
    /** 可选：per-file 增量游标存储。upsert 成功后才推进游标（先落库再推进，防丢数据）。 */
    private readonly cursorStore?: UsageFileCursorStore,
    /** 可选：analytics 统一用量 ingest（upsert 后追加写 usage_events）。 */
    private readonly ingestService?: UsageEventIngestService,
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
        // 先落库再推进 per-file 游标：upsert 成功后才标记文件已处理，
        // 避免 upsert 失败却已推进游标导致该文件被永久跳过、数据缺失。
        if (this.cursorStore && batch.processedFiles && batch.processedFiles.length > 0) {
          await this.cursorStore.save(agentName, batch.processedFiles)
        }
        // 追加写入 analytics usage_events（吞错，不阻断同步主流程）
        if (this.ingestService) {
          try {
            await this.ingestService.ingestSessionBatch(batch.records)
          } catch {
            // 吞错：analytics 写入失败不影响 usage 同步
          }
        }
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
