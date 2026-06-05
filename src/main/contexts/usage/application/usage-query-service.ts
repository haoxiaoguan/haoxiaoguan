/**
 * UsageQueryService — all read paths + rollup rebuild + sync result recording.
 * Mirrors Rust UsageQueryService.
 *
 * Supported platforms (5): claude, codex, gemini-cli, kiro, qoder
 * Pending platforms (7): cursor, windsurf, github-copilot, codebuddy, codebuddy-cn, trae, zed
 */
import type { UsageRollupRepository, UsageSyncStateRepository } from '../domain/usage-repositories'
import { costForModel, totalCostUsd as sumCostUsd } from '../domain/usage-pricing'
import type {
  UsageSummary,
  UsageTrendPoint,
  PlatformUsageBreakdown,
  UsageSyncStatus,
} from '../domain/usage-record'

const SUPPORTED_PLATFORMS = ['claude', 'codex', 'gemini-cli', 'kiro', 'qoder'] as const
const PENDING_PLATFORMS = [
  'cursor',
  'windsurf',
  'github-copilot',
  'codebuddy',
  'codebuddy-cn',
  'trae',
  'zed',
] as const

export class UsageQueryService {
  constructor(
    private readonly rollupRepo: UsageRollupRepository,
    private readonly syncStateRepo: UsageSyncStateRepository,
  ) {}

  async summary(range: string): Promise<UsageSummary> {
    const raw = await this.rollupRepo.summary(range)
    const lastSyncedAt = await this.syncStateRepo.latestSuccessfulSyncAt()
    // 费用：按 model 聚合窗口内 token × 单价（未计价模型按 0）。
    const byModel = await this.rollupRepo.usageByModel(range)
    return {
      totalTokens: raw.inputTokens + raw.outputTokens,
      inputTokens: raw.inputTokens,
      outputTokens: raw.outputTokens,
      cacheReadTokens: raw.cacheReadTokens,
      cacheCreationTokens: raw.cacheCreationTokens,
      requests: raw.requests,
      totalCostUsd: sumCostUsd(byModel),
      lastSyncedAt,
    }
  }

  async trend(range: string, metric: string): Promise<UsageTrendPoint[]> {
    // 费用趋势：按 (date, model) 聚合 → 每日按单价求和。
    if (metric === 'cost') {
      const rows = await this.rollupRepo.usageByDateModel(range)
      const byDate = new Map<string, number>()
      for (const r of rows) {
        byDate.set(r.date, (byDate.get(r.date) ?? 0) + costForModel(r.model, r))
      }
      return [...byDate.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
        .map(([date, cost]) => ({
          date,
          totalTokens: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          requests: 0,
          costUsd: cost,
        }))
    }

    const rows = await this.rollupRepo.trend(range, metric)
    return rows.map((row) => {
      const totalTokens =
        metric === 'requests' ? row.requests : row.inputTokens + row.outputTokens
      return {
        date: row.date,
        totalTokens,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        cacheReadTokens: row.cacheReadTokens,
        cacheCreationTokens: row.cacheCreationTokens,
        requests: row.requests,
        costUsd: 0,
      }
    })
  }

  async platformBreakdown(range: string): Promise<PlatformUsageBreakdown[]> {
    const rows = await this.rollupRepo.platformBreakdown(range)

    // Compute grand total for share ratio
    const grandTotal = rows.reduce((sum, r) => sum + r.inputTokens + r.outputTokens, 0)

    return rows.map((row) => {
      const platformTotal = row.inputTokens + row.outputTokens
      return {
        platform: row.platform,
        totalTokens: platformTotal,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        cacheTokens: row.cacheTokens,
        requests: row.requests,
        shareRatio: grandTotal === 0 ? 0.0 : platformTotal / grandTotal,
      }
    })
  }

  async syncStatus(): Promise<UsageSyncStatus> {
    const syncResults = await this.syncStateRepo.listSyncResultStates()
    const lastSyncedAt = await this.syncStateRepo.latestSuccessfulSyncAt()

    const failedPlatforms = SUPPORTED_PLATFORMS.filter((platform) =>
      syncResults.some((s) => s.readerName === platform && s.status === 'failed'),
    )

    const hasSuccessfulSync = SUPPORTED_PLATFORMS.some((platform) =>
      syncResults.some((s) => s.readerName === platform && s.status === 'success'),
    )

    let healthStatus: string
    if (failedPlatforms.length > 0) {
      healthStatus = 'warning'
    } else if (hasSuccessfulSync) {
      healthStatus = 'healthy'
    } else {
      healthStatus = 'pending'
    }

    return {
      supportedPlatforms: [...SUPPORTED_PLATFORMS],
      pendingPlatforms: [...PENDING_PLATFORMS],
      failedPlatforms,
      lastSyncedAt,
      healthStatus,
    }
  }

  async rebuildRollups(): Promise<void> {
    await this.rollupRepo.rebuildAll()
  }

  async recordSyncResult(succeededReaders: string[], failedReaders: string[]): Promise<void> {
    const updatedAt = Math.floor(Date.now() / 1000)
    await this.syncStateRepo.saveSyncResult(succeededReaders, failedReaders, updatedAt)
  }
}
