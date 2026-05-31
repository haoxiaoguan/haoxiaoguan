// DbArchiveService — SQLite backup/restore operations using better-sqlite3.
// Mirrors Rust infrastructure/db_archive.rs.
//
// VACUUM INTO: creates a consistent hot-copy of the live DB without stopping writes.
// Restore: dump all user-table rows as INSERT statements from the snapshot,
//          then replay into the live DB inside a transaction with foreign_keys OFF.
//          This two-phase approach is intentional — VACUUM INTO cannot restore
//          into an open DB.
//
// NOTE: better-sqlite3 is synchronous. All methods here are sync-wrapped in
// async signatures to match the application service interface and allow future
// migration to async drivers without API changes.

import Database from 'better-sqlite3'
import { BackupError } from '../domain/backup-error'

/** Execute VACUUM INTO on the live DB, writing a consistent snapshot to targetPath. */
export async function vacuumInto(liveDbPath: string, targetPath: string): Promise<void> {
  // Open the live DB in read-write mode (needed for VACUUM INTO).
  // We open a separate connection here so we don't interfere with MikroORM's connection.
  const db = new Database(liveDbPath)
  try {
    // Escape single quotes in path for SQL safety.
    const escaped = targetPath.replace(/'/g, "''")
    db.exec(`VACUUM INTO '${escaped}'`)
  } catch (err: unknown) {
    throw BackupError.db(String(err))
  } finally {
    db.close()
  }
}

/**
 * List user table names from a database connection.
 * Excludes sqlite_* and mikro_orm_* / seaql_* internal tables.
 */
function getUserTables(db: Database.Database): string[] {
  const rows = db
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type='table'
         AND name NOT LIKE 'sqlite_%'
         AND name NOT LIKE 'seaql_%'
         AND name NOT LIKE 'mikro_orm_%'
       ORDER BY name`,
    )
    .all() as Array<{ name: string }>
  return rows.map((r) => r.name)
}

/**
 * Dump all user-table rows from a snapshot DB as INSERT statements.
 * Opens the snapshot read-only. Returns a multi-line SQL string.
 */
export async function dumpFull(snapshotPath: string): Promise<string> {
  const db = new Database(snapshotPath, { readonly: true })
  try {
    const tables = getUserTables(db)
    const lines: string[] = []

    for (const table of tables) {
      // Get column names ordered by cid.
      const cols = (
        db.prepare(`SELECT name FROM pragma_table_info('${table}') ORDER BY cid`).all() as Array<{
          name: string
        }>
      ).map((r) => r.name)

      if (cols.length === 0) continue

      // Build a SELECT that produces INSERT statements using SQLite's quote() function.
      const quotedExpr = cols
        .map((c, i) => (i === 0 ? `quote("${c}")` : `||','||quote("${c}")`))
        .join('')

      const sql = `SELECT 'INSERT INTO "${table}" VALUES('||${quotedExpr}||');' AS stmt FROM "${table}"`
      const rows = db.prepare(sql).all() as Array<{ stmt: string }>
      for (const row of rows) {
        lines.push(row.stmt)
      }
    }

    return lines.join('\n')
  } catch (err: unknown) {
    throw BackupError.db(String(err))
  } finally {
    db.close()
  }
}

/**
 * Apply a full INSERT dump to the live DB.
 * Runs inside a transaction with foreign_keys OFF.
 * Deletes all rows from every user table before replaying.
 */
export async function applyFull(liveDbPath: string, sql: string): Promise<void> {
  const db = new Database(liveDbPath)
  try {
    const tables = getUserTables(db)

    db.exec('PRAGMA foreign_keys = OFF')
    const restore = db.transaction(() => {
      for (const table of tables) {
        db.prepare(`DELETE FROM "${table}"`).run()
      }
      for (const line of sql.split('\n')) {
        const trimmed = line.trim()
        if (trimmed) {
          db.exec(trimmed)
        }
      }
    })
    restore()
    db.exec('PRAGMA foreign_keys = ON')
  } catch (err: unknown) {
    throw BackupError.db(String(err))
  } finally {
    db.close()
  }
}
