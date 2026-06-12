// src/main/contexts/activity/domain/activity-repository.ts
export interface ActivityEventRow {
  sourceKey: string
  tool: string
  metric: string
  /** epoch 秒（喂给 SQLite strftime(..,'unixepoch')） */
  occurredAt: number
  /** 求和量（计数维度=1；code_lines=改动行数） */
  amount: number
}

export interface ActivityTrendPoint {
  date: string // day 桶 YYYY-MM-DD / hour 桶 YYYY-MM-DD HH:00（localtime）
  value: number
}

/** 查询窗口：epoch 秒，闭区间（start <= occurred_at <= end）。 */
export interface ActivityWindow {
  startSec: number
  endSec: number
}

/** 趋势桶粒度：hour=小时桶（查 activity_events），day=日桶（查日 rollup）。 */
export type ActivityGranularity = 'hour' | 'day'

export interface ActivityRepository {
  /** 批量 INSERT OR IGNORE（(source_key, metric) 复合主键 → 幂等）。 */
  upsertEvents(rows: ActivityEventRow[]): Promise<void>
  /** 从 activity_events 全量重算 activity_daily_rollups。 */
  rebuildRollups(): Promise<void>
  /** 窗口内趋势：WHERE metric=?，hour→明细小时桶，day→日 rollup。 */
  trend(window: ActivityWindow, granularity: ActivityGranularity, metric: string): Promise<ActivityTrendPoint[]>
  /** 增量 watermark（毫秒），无则 0。 */
  readWatermark(): Promise<number>
  writeWatermark(value: number): Promise<void>
}
