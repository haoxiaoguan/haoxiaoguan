import { SyncError } from '../domain/sync-error'

// Config export/apply.
//
// export: dump every non-local table's rows as INSERT statements (db.sql) using
//   SQLite's quote() for safe value escaping (a SQLite builtin, NOT reconstructed
//   in JS — the export query runs as raw SQL against the DB).
// apply: inside a transaction, DELETE all non-preserve tables then execute the
//   INSERT lines. Local-only tables in SYNC_SKIP_TABLES are never exported or
//   cleared. Uses a denylist (skip local tables) not an allowlist, so adding a
//   synced table needs no code change.
//
// SQLite restriction: PRAGMA foreign_keys cannot change inside a transaction, so
// it is toggled OFF/ON around the transaction (matching the source).

/** Local-only tables whose rows are skipped on export (schema still present). */
export const SYNC_SKIP_TABLES: readonly string[] = [
  'switch_history',
  'quota_cache',
  'account_quota_state',
  'usage_records',
  'usage_sync_state',
  'usage_daily_rollups',
  'pending_oauth',
  'pending_import',
  'skill_backups',
]

/** Tables preserved (not cleared) on apply. Identical to the skip list. */
export const SYNC_PRESERVE_TABLES: readonly string[] = SYNC_SKIP_TABLES

/** Handle to an open transaction. */
export interface SqlTx {
  run(sql: string): Promise<void>
  commit(): Promise<void>
  rollback(): Promise<void>
}

/**
 * Minimal SQL port config-port needs. Implemented in infrastructure over the
 * shared MikroORM connection; tests can implement it over better-sqlite3.
 */
export interface SqlDatabase {
  /** Execute SQL returning all rows. */
  all<T = Record<string, unknown>>(sql: string): Promise<T[]>
  /** Execute SQL with no result set (DDL/DML/PRAGMA), outside any transaction. */
  run(sql: string): Promise<void>
  /** Begin a transaction. */
  begin(): Promise<SqlTx>
}

const LIST_TABLES_SQL =
  "SELECT name FROM sqlite_master WHERE type='table' " +
  "AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'seaql_%' ORDER BY name"

/**
 * Export all non-local tables as a string of INSERT statements (for upload).
 * Rows of SYNC_SKIP_TABLES are skipped (their schema is still present in the DB).
 */
export async function exportSql(db: SqlDatabase): Promise<string> {
  const tableRows = await db.all<{ name: string }>(LIST_TABLES_SQL)
  const allTables = tableRows.map((r) => r.name)

  let out = ''
  for (const table of allTables) {
    if (SYNC_SKIP_TABLES.includes(table)) {
      continue
    }

    const colRows = await db.all<{ name: string }>(
      `SELECT name FROM pragma_table_info('${table}') ORDER BY cid`,
    )
    const cols = colRows.map((r) => r.name)
    if (cols.length === 0) {
      continue
    }

    // Build the quote() expression per column (SQLite quote() = safe SQL literal).
    const quotedExpr = cols
      .map((c, i) => (i === 0 ? `quote("${c}")` : `||','||quote("${c}")`))
      .join('')

    const sql =
      `SELECT 'INSERT INTO "${table}" VALUES('||${quotedExpr}||');' AS stmt ` +
      `FROM "${table}"`
    const rows = await db.all<{ stmt: string }>(sql)
    for (const row of rows) {
      if (typeof row.stmt === 'string') {
        out += row.stmt + '\n'
      }
    }
  }
  return out
}

/**
 * Apply an INSERT-statement string back into the DB: within a transaction, clear
 * all non-preserve tables then execute each INSERT line. PRESERVE tables are left
 * untouched. foreign_keys is toggled OFF/ON outside the transaction.
 */
export async function applySql(db: SqlDatabase, sql: string): Promise<void> {
  const tableRows = await db.all<{ name: string }>(LIST_TABLES_SQL)
  const tablesToClear = tableRows
    .map((r) => r.name)
    .filter((n) => !SYNC_PRESERVE_TABLES.includes(n))

  // PRAGMA foreign_keys must be set outside the transaction (SQLite restriction).
  await db.run('PRAGMA foreign_keys = OFF')
  const tx = await db.begin()
  try {
    for (const table of tablesToClear) {
      await tx.run(`DELETE FROM "${table}"`)
    }
    for (const rawLine of sql.split('\n')) {
      const line = rawLine.trim()
      if (line.length > 0) {
        await tx.run(line)
      }
    }
    await tx.commit()
  } catch (e) {
    await tx.rollback().catch(() => {})
    await db.run('PRAGMA foreign_keys = ON').catch(() => {})
    throw e instanceof SyncError ? e : SyncError.config((e as Error).message)
  }
  await db.run('PRAGMA foreign_keys = ON')
}
