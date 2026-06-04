// 回归：activity_events 从 M-DASH-1 的单列主键 (source_key) 升级到 M-DASH-2 的
// 复合主键 (source_key, metric)。SQLite 的 updateSchema 不会重建主键，必须有迁移守卫，
// 否则 code_edit（复用 tool_call 的 source_key）会被 INSERT OR IGNORE 静默吞掉。
import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import Database from 'better-sqlite3'
import { initDatabase, getEm, closeDatabase } from '../../../src/main/platform/persistence/database'

afterEach(async () => {
  await closeDatabase()
})

describe('activity_events schema 迁移', () => {
  it('旧单列主键库升级 → 复合主键 + amount，旧数据保留、code_lines 可共存、watermark 归零', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hxg-mig-'))
    const dbFile = join(dir, 'm.db')

    // 1) 用 M-DASH-1 旧 schema 建表（单列主键，无 amount）+ 一条 tool_call 行 + 非零 watermark
    const raw = new Database(dbFile)
    raw.exec(`CREATE TABLE activity_events (
      source_key TEXT PRIMARY KEY, tool TEXT NOT NULL, metric TEXT NOT NULL,
      occurred_at BIGINT NOT NULL DEFAULT 0
    )`)
    raw.exec(`CREATE TABLE activity_scan_state (id TEXT PRIMARY KEY, last_scan_at BIGINT NOT NULL DEFAULT 0)`)
    raw.prepare(`INSERT INTO activity_events (source_key, tool, metric, occurred_at) VALUES ('u#0','claude','tool_calls',1700000000)`).run()
    raw.prepare(`INSERT INTO activity_scan_state (id, last_scan_at) VALUES ('default', 999999)`).run()
    raw.close()

    // 2) 走生产 createSchema 路径（updateSchema + 迁移守卫）
    await initDatabase({ dbName: dbFile, createSchemaOnInit: true })
    const conn = getEm().getConnection()

    // 3) 主键已是复合 (metric, source_key)
    const cols = (await conn.execute(`PRAGMA table_info(activity_events)`, [], 'all')) as any[]
    const pkCols = cols.filter((c: any) => c.pk > 0).map((c: any) => c.name).sort()
    expect(pkCols).toEqual(['metric', 'source_key'])

    // 4) amount 列存在
    expect(cols.map((c: any) => c.name)).toContain('amount')

    // 5) 旧行保留（amount 兜底为 1）
    const old = (await conn.execute(`SELECT amount FROM activity_events WHERE source_key='u#0' AND metric='tool_calls'`, [], 'get')) as any
    expect(Number(old.amount)).toBe(1)

    // 6) 同 source_key 不同 metric 可共存（复合主键生效，code_lines 不被吞）
    await conn.execute(`INSERT OR IGNORE INTO activity_events (source_key, tool, metric, occurred_at, amount) VALUES ('u#0','claude','code_lines',1700000000,7)`)
    const n = (await conn.execute(`SELECT COUNT(*) AS n FROM activity_events`, [], 'get')) as any
    expect(Number(n.n)).toBe(2)

    // 7) watermark 归零 → 触发历史全量补扫（否则旧 code_edit 永远补不回来）
    const ws = (await conn.execute(`SELECT last_scan_at FROM activity_scan_state WHERE id='default'`, [], 'get')) as any
    expect(Number(ws.last_scan_at)).toBe(0)
  })
})
