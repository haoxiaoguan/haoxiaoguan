// src/main/contexts/activity/domain/activity-repository.ts
export interface ActivityEventRow {
  sourceKey: string
  tool: string
  metric: string
  /** epoch 秒（喂给 SQLite strftime(..,'unixepoch')） */
  occurredAt: number
}

export interface ActivityTrendPoint {
  date: string // YYYY-MM-DD (UTC)
  value: number
}

export interface ActivityRepository {
  /** 批量 INSERT OR IGNORE（source_key 唯一 → 幂等）。 */
  upsertEvents(rows: ActivityEventRow[]): Promise<void>
  /** 从 activity_events 全量重算 activity_daily_rollups。 */
  rebuildRollups(): Promise<void>
  /** 按日趋势：WHERE metric=? 锚 MAX(date) 回溯 windowDays。 */
  trend(range: string, metric: string): Promise<ActivityTrendPoint[]>
  /** 增量 watermark（毫秒），无则 0。 */
  readWatermark(): Promise<number>
  writeWatermark(value: number): Promise<void>
}
