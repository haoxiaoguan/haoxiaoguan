import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initDatabase, getOrm, getEm, createSchema, closeDatabase } from '../../../src/main/platform/persistence/database'

let dir: string | null = null

afterEach(async () => {
  await closeDatabase()
  if (dir) {
    rmSync(dir, { recursive: true, force: true })
    dir = null
  }
})

describe('database', () => {
  it('initializes MikroORM on a file db with foreign_keys and WAL pragmas', async () => {
    dir = mkdtempSync(join(tmpdir(), 'hxg-db-'))
    const dbName = join(dir, 'haoxiaoguan.db')
    await initDatabase({ dbName, createSchemaOnInit: true })

    const conn = getOrm().em.getConnection()
    const fk = await conn.execute('PRAGMA foreign_keys')
    expect(Number((fk as Array<Record<string, number>>)[0].foreign_keys)).toBe(1)

    const jm = await conn.execute('PRAGMA journal_mode')
    expect(String((jm as Array<Record<string, string>>)[0].journal_mode).toLowerCase()).toBe('wal')

    expect(existsSync(dbName)).toBe(true)
  })

  it('exposes a forked EntityManager via getEm()', async () => {
    dir = mkdtempSync(join(tmpdir(), 'hxg-db-'))
    await initDatabase({ dbName: join(dir, 'haoxiaoguan.db') })
    const em = getEm()
    expect(em).toBeDefined()
    expect(typeof em.fork).toBe('function')
  })

  it('createSchema is a no-op-safe call with zero entities registered', async () => {
    dir = mkdtempSync(join(tmpdir(), 'hxg-db-'))
    await initDatabase({ dbName: join(dir, 'haoxiaoguan.db') })
    await expect(createSchema()).resolves.toBeUndefined()
  })
})
