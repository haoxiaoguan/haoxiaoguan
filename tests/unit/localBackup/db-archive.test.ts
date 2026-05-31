// Unit tests for DbArchiveService — VACUUM INTO + dump/apply round-trip.
// Uses real temp SQLite files (better-sqlite3 sync API).
// No Electron, no MikroORM.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { vacuumInto, dumpFull, applyFull } from '@main/contexts/localBackup/infrastructure/db-archive-service'

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'hxg-db-archive-test-'))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

/** Create a minimal test DB with one table and some rows. */
function createTestDb(path: string): Database.Database {
  const db = new Database(path)
  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id   TEXT PRIMARY KEY,
      name TEXT NOT NULL
    )
  `)
  return db
}

describe('vacuumInto', () => {
  it('produces a readable snapshot file', async () => {
    const livePath = join(tmpDir, 'live.db')
    const snapPath = join(tmpDir, 'snap.db')

    const db = createTestDb(livePath)
    db.prepare("INSERT INTO items VALUES ('id1', 'Alpha')").run()
    db.close()

    await vacuumInto(livePath, snapPath)

    // Snapshot must exist and be readable.
    const snap = new Database(snapPath, { readonly: true })
    const rows = snap.prepare('SELECT * FROM items').all() as Array<{ id: string; name: string }>
    snap.close()

    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe('id1')
    expect(rows[0].name).toBe('Alpha')
  })

  it('throws BackupError.Db when target already exists', async () => {
    // better-sqlite3's bundled SQLite rejects VACUUM INTO when the target file
    // already exists (SqliteError: output file already exists).
    const livePath = join(tmpDir, 'live2.db')
    const snapPath = join(tmpDir, 'snap2.db')

    const db = createTestDb(livePath)
    db.prepare("INSERT INTO items VALUES ('row1', 'Data')").run()
    db.close()

    // Pre-create the target with a schema so SQLite sees it as an existing DB.
    const old = new Database(snapPath)
    old.exec('CREATE TABLE old_table (x TEXT)')
    old.close()

    await expect(vacuumInto(livePath, snapPath)).rejects.toMatchObject({ kind: 'Db' })
  })
})

describe('dumpFull + applyFull round-trip', () => {
  it('restores rows from snapshot into live DB', async () => {
    const livePath = join(tmpDir, 'live3.db')
    const snapPath = join(tmpDir, 'snap3.db')

    // Seed live DB and take snapshot.
    const live = createTestDb(livePath)
    live.prepare("INSERT INTO items VALUES ('old-1', 'OldRow')").run()
    live.close()

    await vacuumInto(livePath, snapPath)

    // Mutate live DB (simulate changes after snapshot).
    const live2 = new Database(livePath)
    live2.prepare("DELETE FROM items WHERE id='old-1'").run()
    live2.prepare("INSERT INTO items VALUES ('new-1', 'NewRow')").run()
    live2.close()

    // Dump from snapshot, apply to live.
    const sql = await dumpFull(snapPath)
    expect(sql).toContain('old-1')
    expect(sql).toContain('OldRow')

    await applyFull(livePath, sql)

    // Live DB should now match the snapshot state.
    const live3 = new Database(livePath, { readonly: true })
    const rows = live3.prepare('SELECT * FROM items').all() as Array<{ id: string; name: string }>
    live3.close()

    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe('old-1')
    expect(rows[0].name).toBe('OldRow')
  })

  it('applyFull clears existing rows before replaying', async () => {
    const livePath = join(tmpDir, 'live4.db')
    const snapPath = join(tmpDir, 'snap4.db')

    const live = createTestDb(livePath)
    live.prepare("INSERT INTO items VALUES ('snap-row', 'SnapData')").run()
    live.close()

    await vacuumInto(livePath, snapPath)

    // Add extra rows to live after snapshot.
    const live2 = new Database(livePath)
    live2.prepare("INSERT INTO items VALUES ('extra-row', 'ExtraData')").run()
    live2.close()

    const sql = await dumpFull(snapPath)
    await applyFull(livePath, sql)

    const live3 = new Database(livePath, { readonly: true })
    const rows = live3.prepare('SELECT * FROM items').all() as Array<{ id: string; name: string }>
    live3.close()

    // Only the snapshot row should remain.
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe('snap-row')
  })

  it('dumpFull returns empty string for empty tables', async () => {
    const livePath = join(tmpDir, 'live5.db')
    const snapPath = join(tmpDir, 'snap5.db')

    createTestDb(livePath).close()
    await vacuumInto(livePath, snapPath)

    const sql = await dumpFull(snapPath)
    expect(sql.trim()).toBe('')
  })
})
