/**
 * IPC handlers for the usage context.
 * Channel names come from USAGE_CHANNELS constants (src/shared/ipc-channels.ts).
 * Orchestration for sync_usage_sources:
 *   1. syncAll()
 *   2. record_sync_result(succeeded, failed)
 *   3. rebuild_rollups()
 * failedPlatforms are parsed from lastErrors() strings of the form "<name>: <msg>".
 */
import { ipcMain } from 'electron'
import { toIpcError } from '../../../ipc/error'
import { USAGE_CHANNELS } from '../../../../shared/ipc-channels'
import type { UsageSyncService } from '../application/usage-sync-service'
import type { UsageQueryService } from '../application/usage-query-service'

export function registerUsageHandlers(
  syncSvc: UsageSyncService,
  querySvc: UsageQueryService,
): void {
  // sync_usage_sources — no args
  ipcMain.handle(USAGE_CHANNELS.syncUsageSources, async () => {
    try {
      let summary
      let failedPlatforms: string[] = []

      try {
        summary = await syncSvc.syncAll()
        // Parse failed platform names from error strings "<readerName>: <message>"
        failedPlatforms = syncSvc
          .lastErrors()
          .map((e) => e.split(':')[0].trim())
          .filter(Boolean)
        await querySvc.recordSyncResult(summary.platforms, failedPlatforms)
        await querySvc.rebuildRollups()
      } catch (err) {
        // syncAll threw (all platforms failed) — still record the failures
        failedPlatforms = syncSvc
          .lastErrors()
          .map((e) => e.split(':')[0].trim())
          .filter(Boolean)
        if (failedPlatforms.length > 0) {
          await querySvc.recordSyncResult([], failedPlatforms)
        }
        throw err
      }

      return {
        imported: summary.imported,
        failed: summary.failed,
        platforms: summary.platforms,
      }
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  // get_usage_summary — arg: range: string
  ipcMain.handle(USAGE_CHANNELS.getUsageSummary, async (_e, range: string) => {
    try {
      const s = await querySvc.summary(range)
      return {
        totalTokens: s.totalTokens,
        inputTokens: s.inputTokens,
        outputTokens: s.outputTokens,
        cacheReadTokens: s.cacheReadTokens,
        cacheCreationTokens: s.cacheCreationTokens,
        requests: s.requests,
        totalCostUsd: s.totalCostUsd,
        lastSyncedAt: s.lastSyncedAt,
      }
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  // get_usage_trend — args: range: string, metric: string
  ipcMain.handle(
    USAGE_CHANNELS.getUsageTrend,
    async (_e, range: string, metric: string) => {
      try {
        const points = await querySvc.trend(range, metric)
        return points.map((p) => ({
          date: p.date,
          totalTokens: p.totalTokens,
          inputTokens: p.inputTokens,
          outputTokens: p.outputTokens,
          cacheReadTokens: p.cacheReadTokens,
          cacheCreationTokens: p.cacheCreationTokens,
          requests: p.requests,
          costUsd: p.costUsd,
        }))
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )

  // get_usage_platform_breakdown — arg: range: string
  ipcMain.handle(USAGE_CHANNELS.getUsagePlatformBreakdown, async (_e, range: string) => {
    try {
      const rows = await querySvc.platformBreakdown(range)
      return rows.map((r) => ({
        platform: r.platform,
        totalTokens: r.totalTokens,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        cacheTokens: r.cacheTokens,
        requests: r.requests,
        shareRatio: r.shareRatio,
      }))
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  // get_usage_sync_status — no args
  ipcMain.handle(USAGE_CHANNELS.getUsageSyncStatus, async () => {
    try {
      const st = await querySvc.syncStatus()
      return {
        supportedPlatforms: st.supportedPlatforms,
        pendingPlatforms: st.pendingPlatforms,
        failedPlatforms: st.failedPlatforms,
        lastSyncedAt: st.lastSyncedAt,
        healthStatus: st.healthStatus,
      }
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })
}
