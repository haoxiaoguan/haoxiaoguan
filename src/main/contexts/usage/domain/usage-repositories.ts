import type { UsageRecord, UsageSyncResultState } from './usage-record'

/** Port: upsert-only write side for usage_records. */
export interface UsageRecordRepository {
  upsertMany(records: UsageRecord[]): Promise<number>
}

/** Port: rollup read/write side for usage_daily_rollups. */
export interface UsageRollupRepository {
  rebuildAll(): Promise<void>
  summary(range: string): Promise<{
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheCreationTokens: number
    requests: number
  }>
  trend(
    range: string,
    metric: string,
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
    range: string,
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
    range: string,
  ): Promise<
    Array<{
      model: string
      inputTokens: number
      outputTokens: number
      cacheReadTokens: number
      cacheCreationTokens: number
    }>
  >
  /** 按 (date, model) 聚合窗口内 token（费用趋势用；1d→小时桶，其余→日桶）。 */
  usageByDateModel(
    range: string,
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
