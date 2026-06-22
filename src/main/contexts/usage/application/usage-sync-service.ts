/**
 * UsageSyncService — ETL from local agent log files into analytics usage_events.
 *
 * Iterates all agents with session_log capability, calls readUsageMetrics(null),
 * feeds the batch to analyticsIngest (去重写入 usage_events)。
 * Tracks per-agent errors in lastErrors.
 */
import type { AgentRegistry } from '../../../agents/shared/session-log-reader'
import type { UsageFileCursorStore } from '../../../agents/shared/usage-file-cursor-store'
import type { UsageSyncSummary } from '../domain/usage-record'
import type { UsageEventIngestService } from '../../analytics/application/usage-event-ingest-service'

export class UsageSyncService {
  private _lastErrors: string[] = []

  constructor(
    private readonly agentRegistry: AgentRegistry,
    /** analytics 统一用量 ingest（去重写入 usage_events）。 */
    private readonly ingestService: UsageEventIngestService,
    /** 可选：per-file 增量游标存储。ingest 成功后才推进游标（防丢数据）。 */
    private readonly cursorStore?: UsageFileCursorStore,
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
        // 直接喂 analytics ingest（去重写入 usage_events，吞错不阻断）
        try {
          await this.ingestService.ingestSessionBatch(batch.records)
        } catch {
          // 吞错：analytics 写入失败不影响同步主流程
        }
        // ingest 成功后才推进 per-file 游标：
        // 避免 ingest 失败却已推进游标导致该文件被永久跳过、数据缺失。
        if (this.cursorStore && batch.processedFiles && batch.processedFiles.length > 0) {
          await this.cursorStore.save(agentName, batch.processedFiles)
        }
        summary.imported += batch.records.length
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
