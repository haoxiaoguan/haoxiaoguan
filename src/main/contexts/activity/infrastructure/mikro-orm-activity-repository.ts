// src/main/contexts/activity/infrastructure/mikro-orm-activity-repository.ts
import type { EntityManager } from '@mikro-orm/better-sqlite'
import { getEm as defaultGetEm } from '../../../platform/persistence/database'
import type {
  ActivityEventRow,
  ActivityRepository,
  ActivityTrendPoint,
} from '../domain/activity-repository'

function windowDays(range: string): number {
  switch (range) {
    case '1d':
      return 0
    case '7d':
      return 6
    case '30d':
      return 29
    case '90d':
      return 89
    default:
      return 6
  }
}

export class MikroOrmActivityRepository implements ActivityRepository {
  private readonly getEm: () => EntityManager
  constructor(getEmFn?: () => EntityManager) {
    this.getEm = getEmFn ?? defaultGetEm
  }

  async upsertEvents(rows: ActivityEventRow[]): Promise<void> {
    if (rows.length === 0) return
    const conn = this.getEm().getConnection()
    await conn.execute('BEGIN')
    try {
      for (const r of rows) {
        await conn.execute(
          'INSERT OR IGNORE INTO activity_events (source_key, tool, metric, occurred_at, amount) VALUES (?, ?, ?, ?, ?)',
          [r.sourceKey, r.tool, r.metric, r.occurredAt, r.amount ?? 1],
        )
      }
      await conn.execute('COMMIT')
    } catch (err) {
      await conn.execute('ROLLBACK')
      throw err
    }
  }

  async rebuildRollups(): Promise<void> {
    const conn = this.getEm().getConnection()
    await conn.execute('BEGIN')
    try {
      await conn.execute('DELETE FROM activity_daily_rollups')
      await conn.execute(`
        INSERT INTO activity_daily_rollups (date, tool, metric, value, updated_at)
        SELECT
          strftime('%Y-%m-%d', occurred_at, 'unixepoch', 'localtime'),
          tool, metric, SUM(amount),
          CAST(strftime('%s', 'now') AS INTEGER)
        FROM activity_events
        GROUP BY 1, 2, 3
      `)
      await conn.execute('COMMIT')
    } catch (err) {
      await conn.execute('ROLLBACK')
      throw err
    }
  }

  async trend(range: string, metric: string): Promise<ActivityTrendPoint[]> {
    const conn = this.getEm().getConnection()
    if (range === '1d') {
      const rows = (await conn.execute(
        `WITH d AS (SELECT MAX(strftime('%Y-%m-%d', occurred_at, 'unixepoch', 'localtime')) AS day
                    FROM activity_events WHERE metric = ?)
         SELECT strftime('%Y-%m-%d %H:00', occurred_at, 'unixepoch', 'localtime') AS date,
                COALESCE(SUM(amount), 0) AS value
         FROM activity_events
         WHERE metric = ? AND strftime('%Y-%m-%d', occurred_at, 'unixepoch', 'localtime') = (SELECT day FROM d)
         GROUP BY date
         ORDER BY date ASC`,
        [metric, metric],
        'all',
      )) as any[]
      return (rows ?? []).map((r: any) => ({ date: r.date ?? '', value: Number(r.value ?? 0) }))
    }
    const days = `-${windowDays(range)} day`
    const rows = (await conn.execute(
      `WITH max_day AS (SELECT MAX(date) AS value FROM activity_daily_rollups WHERE metric = ?)
       SELECT date, COALESCE(SUM(value), 0) AS value
       FROM activity_daily_rollups
       WHERE metric = ? AND date >= date((SELECT value FROM max_day), ?)
       GROUP BY date
       ORDER BY date ASC`,
      [metric, metric, days],
      'all',
    )) as any[]
    return (rows ?? []).map((r: any) => ({ date: r.date ?? '', value: Number(r.value ?? 0) }))
  }

  async readWatermark(): Promise<number> {
    const conn = this.getEm().getConnection()
    const row = (await conn.execute(
      `SELECT last_scan_at FROM activity_scan_state WHERE id = 'default'`,
      [],
      'get',
    )) as any
    return Number(row?.last_scan_at ?? 0)
  }

  async writeWatermark(value: number): Promise<void> {
    const conn = this.getEm().getConnection()
    await conn.execute(
      `INSERT INTO activity_scan_state (id, last_scan_at) VALUES ('default', ?)
       ON CONFLICT(id) DO UPDATE SET last_scan_at = excluded.last_scan_at`,
      [value],
    )
  }
}
