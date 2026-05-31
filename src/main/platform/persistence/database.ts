import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { MikroORM } from '@mikro-orm/better-sqlite'
import type { EntityManager } from '@mikro-orm/better-sqlite'
import { buildOrmConfig, type OrmConfigOptions } from '../../../../mikro-orm.config'
import { ALL_ENTITIES } from './entities'

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

// Builds all tables on first run. Idempotent: updateSchema only applies missing
// objects, so it is safe to call on every startup. With zero entities
// registered (skeleton phase) this is a no-op.
export async function createSchema(): Promise<void> {
  const generator = getOrm().getSchemaGenerator()
  await generator.updateSchema({ wrap: false })
}

export async function closeDatabase(): Promise<void> {
  if (orm) {
    await orm.close(true)
    orm = null
  }
}
