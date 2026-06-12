import type { UsageRecord, UsageSyncResultState } from './usage-record'

/** 查询窗口：epoch 秒，闭区间（start <= occurred_at <= end），由调用方保证 start <= end。 */
export interface UsageWindow {
  startSec: number
  endSec: number
}

/** 趋势桶粒度：hour=小时桶（查明细表），day=日桶（查日 rollup）。 */
export type UsageGranularity = 'hour' | 'day'

/** Port: upsert-only write side for usage_records. */
export interface UsageRecordRepository {
  upsertMany(records: UsageRecord[]): Promise<number>
}

/** Port: rollup read/write side for usage_daily_rollups. */
export interface UsageRollupRepository {
  rebuildAll(): Promise<void>
  /** 窗口内汇总（查明细表，精确到秒边界）。 */
  summary(window: UsageWindow): Promise<{
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheCreationTokens: number
    requests: number
  }>
  trend(
    window: UsageWindow,
    granularity: UsageGranularity,
  ): Promise<
    Array<{
      date: string
      inputTokens: number
      outputTokens: number
      cacheReadTokens: number
      cacheCreationTokens: number
      requests: number
    }>
  >
  platformBreakdown(
    window: UsageWindow,
  ): Promise<
    Array<{
      platform: string
      inputTokens: number
      outputTokens: number
      cacheTokens: number
      requests: number
    }>
  >
  /** 按 model 聚合窗口内 token（费用计算用；rollup 表无 model 维度，故直接查 usage_records）。 */
  usageByModel(
    window: UsageWindow,
  ): Promise<
    Array<{
      model: string
      inputTokens: number
      outputTokens: number
      cacheReadTokens: number
      cacheCreationTokens: number
    }>
  >
  /** 按 (date, model) 聚合窗口内 token（费用趋势用；hour→小时桶，day→日桶）。 */
  usageByDateModel(
    window: UsageWindow,
    granularity: UsageGranularity,
  ): Promise<
    Array<{
      date: string
      model: string
      inputTokens: number
      outputTokens: number
      cacheReadTokens: number
      cacheCreationTokens: number
    }>
  >
}

/** Port: sentinel-row read/write side for usage_sync_state. */
export interface UsageSyncStateRepository {
  saveSyncResult(
    succeededReaders: string[],
    failedReaders: string[],
    updatedAt: number,
  ): Promise<void>
  latestSuccessfulSyncAt(): Promise<number | null>
  listSyncResultStates(): Promise<UsageSyncResultState[]>
}
