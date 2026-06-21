import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { MikroORM } from '@mikro-orm/better-sqlite'
import type { EntityManager } from '@mikro-orm/better-sqlite'
import { buildOrmConfig, type OrmConfigOptions } from '../../../../mikro-orm.config'
import { ALL_ENTITIES } from './entities'
import { runMigrations } from './migrations'

// MikroORM + better-sqlite3 bootstrap for the Electron main process.
//
// Responsibilities:
//  - open the sqlite file at appDataDir()/haoxiaoguan.db (parent dirs created),
//  - set PRAGMA foreign_keys = ON  (cascade deletes depend on it; better-sqlite3
//    leaves it OFF per connection by default),
//  - set PRAGMA journal_mode = WAL (concurrent reads, fewer fsync stalls),
//  - expose getOrm() / getEm() to repositories,
//  - createSchema() to build all tables on first run via the SchemaGenerator.
//
// Entities are registered EXPLICITLY (src/main/platform/persistence/entities.ts)
// because electron-vite bundles the whole main process into a single main.cjs —
// the bundled-JS entity glob never matches at runtime. The explicit list
// is passed to buildOrmConfig so createSchema() builds every table.

let orm: MikroORM | null = null

export interface InitDatabaseOptions extends OrmConfigOptions {
  /** Run the schema generator (create-if-not-exists) right after connecting. */
  createSchemaOnInit?: boolean
}

export async function initDatabase(options: InitDatabaseOptions = {}): Promise<MikroORM> {
  if (orm) return orm

  // Default to the explicit entity classes unless the caller overrides them
  // (tests may pass their own subset). This is what makes createSchema() build
  // all tables in the bundled Electron app.
  const config = buildOrmConfig({
    entities: options.entities ?? ALL_ENTITIES,
    ...options,
  })
  // dbName is resolved inside buildOrmConfig; ensure its parent dir exists.
  const dbName = (config as { dbName?: string }).dbName
  if (dbName && dbName !== ':memory:') {
    await mkdir(dirname(dbName), { recursive: true })
  }

  orm = await MikroORM.init(config)

  // Per-connection PRAGMAs. better-sqlite3 does not enable FKs by default and
  // WAL must be set explicitly. Run via the underlying driver connection.
  const conn = orm.em.getConnection()
  await conn.execute('PRAGMA foreign_keys = ON')
  await conn.execute('PRAGMA journal_mode = WAL')

  if (options.createSchemaOnInit) {
    await createSchema()
  }

  return orm
}

export function getOrm(): MikroORM {
  if (!orm) throw new Error('Database not initialized — call initDatabase() first')
  return orm
}

// A fresh forked EntityManager per call keeps each unit-of-work isolated, the
// recommended MikroORM usage outside of request-scoped contexts.
export function getEm(): EntityManager {
  return getOrm().em.fork()
}

// Builds all tables on first run. Idempotent.
//
// MikroORM updateSchema 在 knex 3.x + better-sqlite3 12.x 上会生成
// "pragma foreign_keys = on;pragma foreign_keys = off;" 多语句 SQL，
// better-sqlite3 不允许单次执行多语句导致报错。
// workaround：catch 错误后改用 ensureSchema 手动对比实体建表。
export async function createSchema(): Promise<void> {
  const generator = getOrm().getSchemaGenerator()
  try {
    await generator.updateSchema({ wrap: false })
  } catch (err) {
    // updateSchema 因 knex 3.x PRAGMA 多语句 bug 失败，
    // 用 createSchema（不带 wrap）重试——它走不同的代码路径。
    console.warn('[database] updateSchema failed, falling back to createSchema:', err)
    try {
      await generator.createSchema({ wrap: false })
    } catch {
      // createSchema 也可能因已存在的表失败，忽略——表已手动建好或之前已建
      console.warn('[database] createSchema fallback also failed (tables may already exist)')
    }
  }
  // 补 updateSchema 在 SQLite 上做不到的结构变更（主键重建等）。幂等。
  await runMigrations(getOrm().em.getConnection())
}

export async function closeDatabase(): Promise<void> {
  if (orm) {
    await orm.close(true)
    orm = null
  }
}
