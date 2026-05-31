import type { EntityManager } from '@mikro-orm/better-sqlite'
import { getEm as defaultGetEm } from '../../../platform/persistence/database'
import type { SqlDatabase, SqlTx } from '../application/config-port'

// MikroOrmSqlDatabase — implements the config-port SqlDatabase port over the
// shared MikroORM better-sqlite connection (same raw-SQL pattern as the
// mcp/usage repositories: em.getConnection().execute(...)).
//
// config-port needs explicit BEGIN / COMMIT / ROLLBACK control because the
// `PRAGMA foreign_keys` toggle must happen OUTSIDE the transaction (SQLite
// restriction). MikroORM's `transactional()` would wrap the PRAGMA inside, so we
// drive raw BEGIN/COMMIT/ROLLBACK through a single pinned connection instead —
// mirroring the usage rollup repository's transaction handling.
//
// All statements run on ONE connection instance (better-sqlite3 is a single
// synchronous connection per database handle), so BEGIN and subsequent
// statements share the same transaction.

interface RawConnection {
  execute(sql: string, params?: unknown[], method?: 'all' | 'run' | 'get'): Promise<unknown>
}

export class MikroOrmSqlDatabase implements SqlDatabase {
  private readonly getEm: () => EntityManager

  constructor(getEmFn?: () => EntityManager) {
    this.getEm = getEmFn ?? defaultGetEm
  }

  private conn(): RawConnection {
    return this.getEm().getConnection() as unknown as RawConnection
  }

  async all<T = Record<string, unknown>>(sql: string): Promise<T[]> {
    const rows = await this.conn().execute(sql, [], 'all')
    return (rows ?? []) as T[]
  }

  async run(sql: string): Promise<void> {
    await this.conn().execute(sql, [], 'run')
  }

  async begin(): Promise<SqlTx> {
    // Pin one connection so BEGIN and the following statements share the txn.
    const conn = this.conn()
    await conn.execute('BEGIN', [], 'run')
    return new MikroOrmSqlTx(conn)
  }
}

class MikroOrmSqlTx implements SqlTx {
  constructor(private readonly connection: RawConnection) {}

  async run(sql: string): Promise<void> {
    await this.connection.execute(sql, [], 'run')
  }

  async commit(): Promise<void> {
    await this.connection.execute('COMMIT', [], 'run')
  }

  async rollback(): Promise<void> {
    await this.connection.execute('ROLLBACK', [], 'run')
  }
}
