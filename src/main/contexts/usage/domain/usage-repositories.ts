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
