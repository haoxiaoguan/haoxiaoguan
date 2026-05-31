/**
 * MikroORM-backed implementation of UsageRollupRepository.
 * All queries use raw SQLite SQL with strftime/unixepoch — do NOT use ORM DSL
 * for these aggregations (cross-DB portability is not a goal; SQLite-specific
 * functions are required).
 *
 * window_days off-by-one: "7d" → 6, "30d" → 29, "90d" → 89.
 * The window anchors to MAX(date) in the rollup table, not NOW().
 *
 * Schema mismatch fix: Rust rollup SQL used "platform" but migration defines
 * the column as "agent_id". We use agent_id throughout.
 * Accepts an optional getEm factory for testability.
 */
import type { EntityManager } from '@mikro-orm/better-sqlite'
import { getEm as defaultGetEm } from '../../../platform/persistence/database'
import type { UsageRollupRepository } from '../domain/usage-repositories'

function windowDays(range: string): number {
  switch (range) {
    case '7d':
      return 6
    case '30d':
      return 29
    case '90d':
      return 89
    default:
      return 29
  }
}

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
          strftime('%Y-%m-%d', occurred_at, 'unixepoch'),
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

  async summary(range: string): Promise<{
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheCreationTokens: number
    requests: number
  }> {
    const conn = this.getEm().getConnection()
    const days = `-${windowDays(range)} day`

    const row = (await conn.execute(
      `WITH max_day AS (SELECT MAX(date) AS value FROM usage_daily_rollups)
       SELECT
         COALESCE(SUM(input_tokens), 0) AS input_tokens,
         COALESCE(SUM(output_tokens), 0) AS output_tokens,
         COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
         COALESCE(SUM(cache_creation_tokens), 0) AS cache_creation_tokens,
         COALESCE(SUM(records_count), 0) AS requests
       FROM usage_daily_rollups
       WHERE date >= date((SELECT value FROM max_day), ?)`,
      [days],
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
    range: string,
    _metric: string,
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
    const days = `-${windowDays(range)} day`

    const rows = (await conn.execute(
      `WITH max_day AS (SELECT MAX(date) AS value FROM usage_daily_rollups)
       SELECT
         date,
         COALESCE(SUM(input_tokens), 0) AS input_tokens,
         COALESCE(SUM(output_tokens), 0) AS output_tokens,
         COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
         COALESCE(SUM(cache_creation_tokens), 0) AS cache_creation_tokens,
         COALESCE(SUM(records_count), 0) AS requests
       FROM usage_daily_rollups
       WHERE date >= date((SELECT value FROM max_day), ?)
       GROUP BY date
       ORDER BY date ASC`,
      [days],
      'all',
    )) as any[]

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
    range: string,
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
    const days = `-${windowDays(range)} day`

    const rows = (await conn.execute(
      `WITH max_day AS (SELECT MAX(date) AS value FROM usage_daily_rollups)
       SELECT
         agent_id AS platform,
         COALESCE(SUM(input_tokens), 0) AS input_tokens,
         COALESCE(SUM(output_tokens), 0) AS output_tokens,
         COALESCE(SUM(cache_read_tokens + cache_creation_tokens), 0) AS cache_tokens,
         COALESCE(SUM(records_count), 0) AS requests
       FROM usage_daily_rollups
       WHERE date >= date((SELECT value FROM max_day), ?)
       GROUP BY agent_id
       ORDER BY SUM(input_tokens + output_tokens) DESC, agent_id ASC`,
      [days],
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
}
