// 一次性 schema 迁移守卫——补 MikroORM updateSchema 在 SQLite 上做不到的结构变更
// （如主键重建：SQLite 不支持 ALTER 主键，只能 table-rebuild）。
// 每次启动在 createSchema 的 updateSchema 之后调用；全部迁移须幂等（已迁移即空操作）。
import type { EntityManager } from '@mikro-orm/better-sqlite'

type SqlConn = ReturnType<EntityManager['getConnection']>

/**
 * activity_events 主键由单列 (source_key) 升级为复合 (source_key, metric)。
 *
 * 背景：updateSchema 在 SQLite 上只会 ADD COLUMN，不会重建主键。存量库若停留在单列
 * 主键，code_edit 事件（刻意复用对应 tool_call 的 source_key）会与 tool_call 行撞主键，
 * 被 INSERT OR IGNORE 静默吞掉，导致 code_lines 维度恒缺失。这里在存量库上手动重建表，
 * 并把扫描 watermark 归零以触发历史全量补扫（INSERT OR IGNORE 让重扫无害）。
 */
export async function migrateActivityEventsCompositePk(conn: SqlConn): Promise<void> {
  const cols = (await conn.execute(`PRAGMA table_info(activity_events)`, [], 'all')) as Array<{
    name: string
    pk: number
  }>
  if (!cols || cols.length === 0) return // 表尚不存在（createSchema 已按实体建为复合主键）
  const pkCols = cols.filter((c) => c.pk > 0).map((c) => c.name)
  if (pkCols.includes('source_key') && pkCols.includes('metric')) return // 已是复合主键

  const amountExpr = cols.some((c) => c.name === 'amount') ? 'COALESCE(amount, 1)' : '1'
  await conn.execute('BEGIN')
  try {
    await conn.execute(`ALTER TABLE activity_events RENAME TO activity_events_old`)
    await conn.execute(`CREATE TABLE activity_events (
      source_key TEXT NOT NULL, metric TEXT NOT NULL, tool TEXT NOT NULL,
      occurred_at BIGINT NOT NULL DEFAULT 0, amount INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (source_key, metric)
    )`)
    await conn.execute(`INSERT INTO activity_events (source_key, metric, tool, occurred_at, amount)
      SELECT source_key, metric, tool, occurred_at, ${amountExpr} FROM activity_events_old`)
    await conn.execute(`DROP TABLE activity_events_old`)
    await conn.execute(`UPDATE activity_scan_state SET last_scan_at = 0`)
    await conn.execute('COMMIT')
  } catch (e) {
    await conn.execute('ROLLBACK')
    throw e
  }
}

/** 按顺序运行所有迁移守卫。createSchema 在 updateSchema 之后调用。 */
export async function runMigrations(conn: SqlConn): Promise<void> {
  await migrateActivityEventsCompositePk(conn)
}
