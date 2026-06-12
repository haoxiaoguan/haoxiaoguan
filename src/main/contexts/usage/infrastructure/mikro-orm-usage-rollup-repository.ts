/**
 * MikroORM-backed implementation of UsageRollupRepository.
 * All queries use raw SQLite SQL with strftime/unixepoch — do NOT use ORM DSL
 * for these aggregations (cross-DB portability is not a goal; SQLite-specific
 * functions are required).
 *
 * 查询窗口为显式 epoch 秒闭区间（UsageWindow），由渲染层时间选择器给出：
 * - summary/platformBreakdown/usageByModel 走 usage_records 明细（精确秒边界）；
 * - trend/usageByDateModel 按粒度：hour→明细小时桶；day→usage_daily_rollups 日桶
 *   （日桶口径：窗口起止所在的 localtime 日期，含首尾全日）。
 *
 * Schema mismatch fix: Rust rollup SQL used "platform" but migration defines
 * the column as "agent_id". We use agent_id throughout.
 * Accepts an optional getEm factory for testability.
 */
import type { EntityManager } from '@mikro-orm/better-sqlite'
import { getEm as defaultGetEm } from '../../../platform/persistence/database'
import type {
  UsageGranularity,
  UsageRollupRepository,
  UsageWindow,
} from '../domain/usage-repositories'

export class MikroOrmUsageRollupRepository implements UsageRollupRepository {
  private readonly getEm: () => EntityManager

  constructor(getEmFn?: () => EntityManager) {
    this.getEm = getEmFn ?? defaultGetEm
  }

  async rebuildAll(): Promise<void> {
    const conn = this.getEm().getConnection()

    // Full DELETE + INSERT in a transaction — must not leave the table empty mid-flight.
    await conn.execute('BEGIN')
    try {
      await conn.execute('DELETE FROM usage_daily_rollups')
      await conn.execute(`
        INSERT INTO usage_daily_rollups (
          date, agent_id, source_kind, records_count,
          input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, updated_at
        )
        SELECT
          strftime('%Y-%m-%d', occurred_at, 'unixepoch', 'localtime'),
          agent_id,
          source_kind,
          COUNT(*),
          COALESCE(SUM(input_tokens), 0),
          COALESCE(SUM(output_tokens), 0),
          COALESCE(SUM(cache_read_tokens), 0),
          COALESCE(SUM(cache_creation_tokens), 0),
          CAST(strftime('%s', 'now') AS INTEGER)
        FROM usage_records
        GROUP BY 1, 2, 3
      `)
      await conn.execute('COMMIT')
    } catch (err) {
      await conn.execute('ROLLBACK')
      throw err
    }
  }

  async summary(window: UsageWindow): Promise<{
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheCreationTokens: number
    requests: number
  }> {
    const conn = this.getEm().getConnection()
    const row = (await conn.execute(
      `SELECT
         COALESCE(SUM(input_tokens), 0) AS input_tokens,
         COALESCE(SUM(output_tokens), 0) AS output_tokens,
         COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
         COALESCE(SUM(cache_creation_tokens), 0) AS cache_creation_tokens,
         COUNT(*) AS requests
       FROM usage_records
       WHERE occurred_at >= ? AND occurred_at <= ?`,
      [window.startSec, window.endSec],
      'get',
    )) as any ?? {}

    return {
      inputTokens: Number(row.input_tokens ?? 0),
      outputTokens: Number(row.output_tokens ?? 0),
      cacheReadTokens: Number(row.cache_read_tokens ?? 0),
      cacheCreationTokens: Number(row.cache_creation_tokens ?? 0),
      requests: Number(row.requests ?? 0),
    }
  }

  async trend(
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
  > {
    const conn = this.getEm().getConnection()
    let rows: any[]
    if (granularity === 'hour') {
      rows = (await conn.execute(
        `SELECT strftime('%Y-%m-%d %H:00', occurred_at, 'unixepoch', 'localtime') AS date,
           COALESCE(SUM(input_tokens), 0) AS input_tokens,
           COALESCE(SUM(output_tokens), 0) AS output_tokens,
           COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
           COALESCE(SUM(cache_creation_tokens), 0) AS cache_creation_tokens,
           COUNT(*) AS requests
         FROM usage_records
         WHERE occurred_at >= ? AND occurred_at <= ?
         GROUP BY date ORDER BY date ASC`,
        [window.startSec, window.endSec],
        'all',
      )) as any[]
    } else {
      rows = (await conn.execute(
        `SELECT
           date,
           COALESCE(SUM(input_tokens), 0) AS input_tokens,
           COALESCE(SUM(output_tokens), 0) AS output_tokens,
           COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
           COALESCE(SUM(cache_creation_tokens), 0) AS cache_creation_tokens,
           COALESCE(SUM(records_count), 0) AS requests
         FROM usage_daily_rollups
         WHERE date >= date(?, 'unixepoch', 'localtime') AND date <= date(?, 'unixepoch', 'localtime')
         GROUP BY date
         ORDER BY date ASC`,
        [window.startSec, window.endSec],
        'all',
      )) as any[]
    }

    return (rows ?? []).map((row: any) => ({
      date: row.date ?? '',
      inputTokens: Number(row.input_tokens ?? 0),
      outputTokens: Number(row.output_tokens ?? 0),
      cacheReadTokens: Number(row.cache_read_tokens ?? 0),
      cacheCreationTokens: Number(row.cache_creation_tokens ?? 0),
      requests: Number(row.requests ?? 0),
    }))
  }

  async platformBreakdown(
    window: UsageWindow,
  ): Promise<
    Array<{
      platform: string
      inputTokens: number
      outputTokens: number
      cacheTokens: number
      requests: number
    }>
  > {
    const conn = this.getEm().getConnection()
    const rows = (await conn.execute(
      `SELECT
         agent_id AS platform,
         COALESCE(SUM(input_tokens), 0) AS input_tokens,
         COALESCE(SUM(output_tokens), 0) AS output_tokens,
         COALESCE(SUM(cache_read_tokens + cache_creation_tokens), 0) AS cache_tokens,
         COUNT(*) AS requests
       FROM usage_records
       WHERE occurred_at >= ? AND occurred_at <= ?
       GROUP BY agent_id
       ORDER BY SUM(input_tokens + output_tokens) DESC, agent_id ASC`,
      [window.startSec, window.endSec],
      'all',
    )) as any[]

    return (rows ?? []).map((row: any) => ({
      platform: row.platform ?? '',
      inputTokens: Number(row.input_tokens ?? 0),
      outputTokens: Number(row.output_tokens ?? 0),
      cacheTokens: Number(row.cache_tokens ?? 0),
      requests: Number(row.requests ?? 0),
    }))
  }

  // 费用计算需要 model 维度，而 usage_daily_rollups 不含 model，故直接查 usage_records。
  async usageByModel(window: UsageWindow): Promise<
    Array<{
      model: string
      inputTokens: number
      outputTokens: number
      cacheReadTokens: number
      cacheCreationTokens: number
    }>
  > {
    const conn = this.getEm().getConnection()
    const rows = (await conn.execute(
      `SELECT model AS model,
         COALESCE(SUM(input_tokens), 0) AS input_tokens,
         COALESCE(SUM(output_tokens), 0) AS output_tokens,
         COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
         COALESCE(SUM(cache_creation_tokens), 0) AS cache_creation_tokens
       FROM usage_records
       WHERE occurred_at >= ? AND occurred_at <= ?
       GROUP BY model`,
      [window.startSec, window.endSec],
      'all',
    )) as any[]
    return (rows ?? []).map((row: any) => ({
      model: row.model ?? '',
      inputTokens: Number(row.input_tokens ?? 0),
      outputTokens: Number(row.output_tokens ?? 0),
      cacheReadTokens: Number(row.cache_read_tokens ?? 0),
      cacheCreationTokens: Number(row.cache_creation_tokens ?? 0),
    }))
  }

  async usageByDateModel(
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
  > {
    const conn = this.getEm().getConnection()
    const bucket =
      granularity === 'hour'
        ? `strftime('%Y-%m-%d %H:00', occurred_at, 'unixepoch', 'localtime')`
        : `date(occurred_at, 'unixepoch', 'localtime')`
    const rows = (await conn.execute(
      `SELECT ${bucket} AS date, model AS model,
         COALESCE(SUM(input_tokens), 0) AS input_tokens,
         COALESCE(SUM(output_tokens), 0) AS output_tokens,
         COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
         COALESCE(SUM(cache_creation_tokens), 0) AS cache_creation_tokens
       FROM usage_records
       WHERE occurred_at >= ? AND occurred_at <= ?
       GROUP BY date, model`,
      [window.startSec, window.endSec],
      'all',
    )) as any[]
    return (rows ?? []).map((row: any) => ({
      date: row.date ?? '',
      model: row.model ?? '',
      inputTokens: Number(row.input_tokens ?? 0),
      outputTokens: Number(row.output_tokens ?? 0),
      cacheReadTokens: Number(row.cache_read_tokens ?? 0),
      cacheCreationTokens: Number(row.cache_creation_tokens ?? 0),
    }))
  }
}
