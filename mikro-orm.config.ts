import { join } from 'node:path'
import { defineConfig } from '@mikro-orm/better-sqlite'
import { ReflectMetadataProvider } from '@mikro-orm/core'
import { appDataDir } from './src/main/platform/persistence/paths'

// Single source of truth for the MikroORM configuration. Consumed by both the
// MikroORM CLI (this file's default export) and the runtime initializer
// (src/main/platform/persistence/database.ts via buildOrmConfig).
//
// Entities are NOT enumerated here. Each business context (Plan 2+) defines its
// own decorator entities under contexts/<ctx>/infrastructure/*.entity.ts; the
// agents adapters define theirs under agents/**/*.entity.ts. They are discovered
// by glob so later contexts plug in without editing this file.
//
// emitDecoratorMetadata is provided by unplugin-swc for the main build (esbuild
// cannot), so ReflectMetadataProvider can read column types off the decorators.
// Entity classes must NOT be name-mangled (reflection relies on class/property
// names) — electron.vite.config.ts disables minify for the main bundle.

const ENTITY_GLOBS_JS = [
  'out/main/**/contexts/**/infrastructure/*.entity.js',
  'out/main/**/agents/**/*.entity.js',
]

const ENTITY_GLOBS_TS = [
  'src/main/contexts/**/infrastructure/*.entity.ts',
  'src/main/agents/**/*.entity.ts',
]

export interface OrmConfigOptions {
  /** Absolute path to the sqlite file. Defaults to appDataDir()/haoxiaoguan.db. */
  dbName?: string
  /** Base directory the entity globs are resolved against. Defaults to cwd. */
  baseDir?: string
  /** Enable MikroORM SQL logging. */
  debug?: boolean
  /**
   * Explicit entity classes. When provided (the Electron runtime path), these
   * are used INSTEAD of the file globs. The electron-vite main build bundles
   * every context into a single `main.cjs`, so the bundled-JS entity glob never
   * matches at runtime — the runtime initializer (database.ts) passes the
   * concrete entity classes here so `createSchema()` builds all tables.
   * The MikroORM CLI / dev path still uses the TS glob (default export below).
   */
  entities?: unknown[]
}

export function buildOrmConfig(options: OrmConfigOptions = {}) {
  const baseDir = options.baseDir ?? process.cwd()
  const dbName = options.dbName ?? join(appDataDir(), 'haoxiaoguan.db')
  const useExplicitEntities = options.entities !== undefined && options.entities.length > 0
  return defineConfig({
    metadataProvider: ReflectMetadataProvider,
    dbName,
    baseDir,
    // Runtime (Electron): explicit classes. CLI/dev: file globs.
    entities: useExplicitEntities
      ? (options.entities as never[])
      : (ENTITY_GLOBS_JS as never[]),
    entitiesTs: useExplicitEntities ? (options.entities as never[]) : ENTITY_GLOBS_TS,
    debug: options.debug ?? false,
    // Foreign-key cascades in the schema depend on PRAGMA foreign_keys = ON;
    // better-sqlite3 leaves it OFF by default. database.ts enforces it (plus
    // journal_mode = WAL) after the connection opens.
    discovery: {
      // Safe to init before any context registers an entity (skeleton phase).
      warnWhenNoEntities: false,
      requireEntitiesArray: false,
    },
  })
}

export default buildOrmConfig()
