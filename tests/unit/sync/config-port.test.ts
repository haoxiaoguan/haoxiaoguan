import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MikroORM } from '@mikro-orm/better-sqlite'
import type { EntityManager } from '@mikro-orm/better-sqlite'
import { McpServerEntity } from '../../../src/main/contexts/mcp/infrastructure/mcp-server.entity'
import { MikroOrmSqlDatabase } from '../../../src/main/contexts/sync/infrastructure/mikro-orm-sql-database'
import { exportSql, applySql, SYNC_SKIP_TABLES } from '../../../src/main/contexts/sync/application/config-port'

// config-port export/apply over a real in-memory SQLite (via MikroORM
// better-sqlite + the MikroOrmSqlDatabase adapter). We use mcp_servers as a
// synced table and create a local-only skip table to assert it is never exported
// or cleared.

let orm: MikroORM
let getEm: () => EntityManager
let db: MikroOrmSqlDatabase

beforeEach(async () => {
  orm = await MikroORM.init({
    driver: (await import('@mikro-orm/better-sqlite')).SqliteDriver,
    dbName: ':memory:',
    entities: [McpServerEntity],
    allowGlobalContext: true,
  })
  await orm.getSchemaGenerator().createSchema()
  getEm = () => orm.em.fork()
  db = new MikroOrmSqlDatabase(getEm)

  // A local-only skip table (in SYNC_SKIP_TABLES) — rows must be neither exported
  // nor cleared.
  await db.run('CREATE TABLE switch_history (id INTEGER PRIMARY KEY, note TEXT)')
  await db.run("INSERT INTO switch_history (id, note) VALUES (1, 'keep-me')")
})

afterEach(async () => {
  await orm.close(true)
})

async function insertServer(id: string, name: string): Promise<void> {
  const conn = getEm().getConnection()
  const now = 1700000000
  await conn.execute(
    `INSERT INTO mcp_servers
       (id, name, description, server_json, apps_json, homepage, docs, tags_json,
        created_at, updated_at, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, name, null, '{}', '{}', null, null, '[]', now, now, 0],
  )
}

describe('config-port export/apply', () => {
  it('SYNC_SKIP_TABLES contains the expected local-only tables', () => {
    expect(SYNC_SKIP_TABLES).toContain('switch_history')
    expect(SYNC_SKIP_TABLES).toContain('usage_records')
    expect(SYNC_SKIP_TABLES).toContain('skill_backups')
  })

  it('exports synced tables as INSERT statements and skips local tables', async () => {
    await insertServer('mcp-1', "Robert'); DROP TABLE x;--")
    const sql = await exportSql(db)
    expect(sql).toContain('INSERT INTO "mcp_servers" VALUES(')
    expect(sql).toContain('mcp-1')
    // quote() escapes the embedded single quote safely.
    expect(sql).toContain("Robert''); DROP TABLE x;--")
    // The skip table must NOT be exported.
    expect(sql).not.toContain('switch_history')
    expect(sql).not.toContain('keep-me')
  })

  it('apply clears synced tables then replays INSERTs, preserving skip tables', async () => {
    await insertServer('src-1', 'Source One')
    const dump = await exportSql(db)

    // Simulate a target device: a different synced row + same skip row.
    await db.run('DELETE FROM mcp_servers')
    await insertServer('stale', 'Stale Row')

    await applySql(db, dump)

    const servers = (await db.all('SELECT id FROM mcp_servers ORDER BY id')) as Array<{
      id: string
    }>
    expect(servers.map((r) => r.id)).toEqual(['src-1'])

    // Skip table preserved (never cleared).
    const hist = (await db.all('SELECT note FROM switch_history')) as Array<{ note: string }>
    expect(hist).toHaveLength(1)
    expect(hist[0].note).toBe('keep-me')
  })

  it('apply rolls back on a malformed INSERT line (db unchanged)', async () => {
    await insertServer('before', 'Before')
    // Inject a broken statement after a DELETE so a rollback restores the row.
    const badDump = 'INSERT INTO "mcp_servers" VALUES(not valid sql here);\n'
    await expect(applySql(db, badDump)).rejects.toBeTruthy()

    // Row still present (transaction rolled back the DELETE).
    const servers = (await db.all('SELECT id FROM mcp_servers')) as Array<{ id: string }>
    expect(servers.map((r) => r.id)).toEqual(['before'])
  })
})
