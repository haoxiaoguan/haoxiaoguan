// src/main/contexts/activity/infrastructure/mikro-orm-activity-repository.ts
import type { EntityManager } from '@mikro-orm/better-sqlite'
import { getEm as defaultGetEm } from '../../../platform/persistence/database'
import type {
  ActivityEventRow,
  ActivityGranularity,
  ActivityRepository,
  ActivityTrendPoint,
  ActivityWindow,
} from '../domain/activity-repository'

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

  async trend(
    window: ActivityWindow,
    granularity: ActivityGranularity,
    metric: string,
  ): Promise<ActivityTrendPoint[]> {
    const conn = this.getEm().getConnection()
    if (granularity === 'hour') {
      const rows = (await conn.execute(
        `SELECT strftime('%Y-%m-%d %H:00', occurred_at, 'unixepoch', 'localtime') AS date,
                COALESCE(SUM(amount), 0) AS value
         FROM activity_events
         WHERE metric = ? AND occurred_at >= ? AND occurred_at <= ?
         GROUP BY date
         ORDER BY date ASC`,
        [metric, window.startSec, window.endSec],
        'all',
      )) as any[]
      return (rows ?? []).map((r: any) => ({ date: r.date ?? '', value: Number(r.value ?? 0) }))
    }
    const rows = (await conn.execute(
      `SELECT date, COALESCE(SUM(value), 0) AS value
       FROM activity_daily_rollups
       WHERE metric = ? AND date >= date(?, 'unixepoch', 'localtime') AND date <= date(?, 'unixepoch', 'localtime')
       GROUP BY date
       ORDER BY date ASC`,
      [metric, window.startSec, window.endSec],
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
