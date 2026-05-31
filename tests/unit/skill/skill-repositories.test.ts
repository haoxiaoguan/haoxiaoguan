/**
 * Repository round-trip tests using an in-memory SQLite database.
 * Each repository accepts an optional getEm factory -- tests pass their own
 * factory backed by a local MikroORM instance, avoiding the global ORM
 * singleton and its entity-glob discovery (which cannot load .ts files at runtime).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MikroORM } from '@mikro-orm/better-sqlite'
import { ReflectMetadataProvider } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/better-sqlite'
import { MikroOrmInstalledSkillRepository } from '../../../src/main/contexts/skill/infrastructure/mikro-orm-installed-skill-repository'
import { MikroOrmSkillRepoRepository } from '../../../src/main/contexts/skill/infrastructure/mikro-orm-skill-repo-repository'
import { MikroOrmSkillBackupRepository } from '../../../src/main/contexts/skill/infrastructure/mikro-orm-skill-backup-repository'
import { InstalledSkill } from '../../../src/main/contexts/skill/domain/installed-skill'
import { SkillRepo } from '../../../src/main/contexts/skill/domain/skill-repo'
import { SkillBackupEntry } from '../../../src/main/contexts/skill/domain/skill-backup'

let testOrm: MikroORM

async function createSchema(orm: MikroORM): Promise<void> {
  const conn = orm.em.getConnection()
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS installed_skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      directory TEXT NOT NULL,
      repo_owner TEXT,
      repo_name TEXT,
      repo_branch TEXT,
      readme_url TEXT,
      apps_json TEXT NOT NULL,
      installed_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      content_hash TEXT,
      ssot_path TEXT NOT NULL,
      storage_location TEXT NOT NULL
    )
  `)
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS skill_repos (
      owner TEXT NOT NULL,
      name TEXT NOT NULL,
      branch TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      sort_order INTEGER NOT NULL,
      added_at INTEGER NOT NULL,
      PRIMARY KEY (owner, name)
    )
  `)
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS skill_backups (
      backup_id TEXT PRIMARY KEY,
      skill_id TEXT NOT NULL,
      snapshot_json TEXT NOT NULL,
      archive_path TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `)
}

beforeEach(async () => {
  testOrm = await MikroORM.init({
    metadataProvider: ReflectMetadataProvider,
    dbName: ':memory:',
    entities: [],
    entitiesTs: [],
    discovery: { warnWhenNoEntities: false, requireEntitiesArray: false },
    debug: false,
  })
  await createSchema(testOrm)
})

afterEach(async () => {
  await testOrm.close(true)
})

function getEmFn(): () => EntityManager {
  return () => testOrm.em.fork()
}

// --- InstalledSkillRepository ---

describe('MikroOrmInstalledSkillRepository', () => {
  const makeSkill = (id: string, directory: string) =>
    InstalledSkill.create({
      id,
      name: `skill-${id}`,
      directory,
      apps: { cursor: true },
      installed_at: 1000,
      updated_at: 1001,
      ssot_path: `/home/.haoxiaoguan/skills/${directory}`,
    })

  it('findAll returns empty initially', async () => {
    const repo = new MikroOrmInstalledSkillRepository(getEmFn())
    const all = await repo.findAll()
    expect(all).toHaveLength(0)
  })

  it('save and findById round-trips', async () => {
    const repo = new MikroOrmInstalledSkillRepository(getEmFn())
    const skill = makeSkill('s1', 'my-skill')
    await repo.save(skill)
    const found = await repo.findById('s1')
    expect(found).toBeDefined()
    expect(found!.name).toBe('skill-s1')
    expect(found!.directory).toBe('my-skill')
    expect(found!.apps['cursor']).toBe(true)
  })

  it('findByDirectory returns correct skill', async () => {
    const repo = new MikroOrmInstalledSkillRepository(getEmFn())
    await repo.save(makeSkill('s1', 'my-skill'))
    const found = await repo.findByDirectory('my-skill')
    expect(found).toBeDefined()
    expect(found!.id).toBe('s1')
  })

  it('findByDirectory returns undefined for unknown directory', async () => {
    const repo = new MikroOrmInstalledSkillRepository(getEmFn())
    const found = await repo.findByDirectory('nonexistent')
    expect(found).toBeUndefined()
  })

  it('save acts as upsert (update existing)', async () => {
    const repo = new MikroOrmInstalledSkillRepository(getEmFn())
    const skill = makeSkill('s1', 'my-skill')
    await repo.save(skill)
    skill.apps['codex'] = true
    await repo.save(skill)
    const found = await repo.findById('s1')
    expect(found!.apps['codex']).toBe(true)
  })

  it('delete removes the record', async () => {
    const repo = new MikroOrmInstalledSkillRepository(getEmFn())
    await repo.save(makeSkill('s2', 'to-delete'))
    await repo.delete('s2')
    const found = await repo.findById('s2')
    expect(found).toBeUndefined()
  })

  it('findAll returns all saved skills', async () => {
    const repo = new MikroOrmInstalledSkillRepository(getEmFn())
    await repo.save(makeSkill('s1', 'skill-a'))
    await repo.save(makeSkill('s2', 'skill-b'))
    await repo.delete('s2')
    const all = await repo.findAll()
    expect(all.some((s) => s.id === 's1')).toBe(true)
    expect(all.some((s) => s.id === 's2')).toBe(false)
  })
})

// --- SkillRepoRepository ---

describe('MikroOrmSkillRepoRepository', () => {
  it('findAll returns empty initially', async () => {
    const repo = new MikroOrmSkillRepoRepository(getEmFn())
    expect(await repo.findAll()).toHaveLength(0)
  })

  it('save and findAll round-trips', async () => {
    const repo = new MikroOrmSkillRepoRepository(getEmFn())
    await repo.save(SkillRepo.create({ owner: 'acme', name: 'skills', branch: 'main', added_at: 500 }))
    const all = await repo.findAll()
    expect(all).toHaveLength(1)
    expect(all[0].owner).toBe('acme')
    expect(all[0].enabled).toBe(true)
  })

  it('findEnabled returns only enabled repos', async () => {
    const repo = new MikroOrmSkillRepoRepository(getEmFn())
    await repo.save(SkillRepo.create({ owner: 'acme', name: 'enabled', branch: 'main', enabled: true, added_at: 500 }))
    await repo.save(SkillRepo.create({ owner: 'acme', name: 'disabled', branch: 'main', enabled: false, added_at: 600 }))
    const enabled = await repo.findEnabled()
    expect(enabled.every((r) => r.enabled)).toBe(true)
    expect(enabled.some((r) => r.name === 'disabled')).toBe(false)
  })

  it('save acts as upsert on composite PK', async () => {
    const repo = new MikroOrmSkillRepoRepository(getEmFn())
    await repo.save(SkillRepo.create({ owner: 'acme', name: 'skills', branch: 'main', added_at: 500 }))
    await repo.save(SkillRepo.create({ owner: 'acme', name: 'skills', branch: 'develop', added_at: 700 }))
    const all = await repo.findAll()
    const found = all.find((r) => r.owner === 'acme' && r.name === 'skills')
    expect(found!.branch).toBe('develop')
  })

  it('delete removes the record', async () => {
    const repo = new MikroOrmSkillRepoRepository(getEmFn())
    await repo.save(SkillRepo.create({ owner: 'acme', name: 'skills', branch: 'main', added_at: 500 }))
    await repo.delete('acme', 'skills')
    const all = await repo.findAll()
    expect(all.some((r) => r.owner === 'acme' && r.name === 'skills')).toBe(false)
  })
})

// --- SkillBackupRepository ---

describe('MikroOrmSkillBackupRepository', () => {
  it('findAll returns empty initially', async () => {
    const repo = new MikroOrmSkillBackupRepository(getEmFn())
    expect(await repo.findAll()).toHaveLength(0)
  })

  it('save and findAll round-trips', async () => {
    const repo = new MikroOrmSkillBackupRepository(getEmFn())
    await repo.save(SkillBackupEntry.create({ backup_id: 'b1', skill_id: 's1', snapshot_json: '{"id":"s1"}', archive_path: '/tmp/b1.json', created_at: 2000 }))
    const all = await repo.findAll()
    expect(all).toHaveLength(1)
    expect(all[0].backup_id).toBe('b1')
    expect(all[0].snapshot_json).toBe('{"id":"s1"}')
  })

  it('findBySkillId returns correct entries ordered by created_at DESC', async () => {
    const repo = new MikroOrmSkillBackupRepository(getEmFn())
    await repo.save(SkillBackupEntry.create({ backup_id: 'b1', skill_id: 's1', snapshot_json: '{"v":1}', archive_path: '/tmp/b1.json', created_at: 2000 }))
    await repo.save(SkillBackupEntry.create({ backup_id: 'b2', skill_id: 's1', snapshot_json: '{"v":2}', archive_path: '/tmp/b2.json', created_at: 3000 }))
    const found = await repo.findBySkillId('s1')
    expect(found).toHaveLength(2)
    expect(found[0].backup_id).toBe('b2')
  })

  it('findBySkillId returns empty for unknown skill', async () => {
    const repo = new MikroOrmSkillBackupRepository(getEmFn())
    expect(await repo.findBySkillId('unknown')).toHaveLength(0)
  })

  it('delete removes the record', async () => {
    const repo = new MikroOrmSkillBackupRepository(getEmFn())
    await repo.save(SkillBackupEntry.create({ backup_id: 'b1', skill_id: 's1', snapshot_json: '{}', archive_path: '/tmp/b1.json', created_at: 1 }))
    await repo.save(SkillBackupEntry.create({ backup_id: 'b2', skill_id: 's1', snapshot_json: '{}', archive_path: '/tmp/b2.json', created_at: 2 }))
    await repo.delete('b1')
    const all = await repo.findAll()
    expect(all.some((e) => e.backup_id === 'b1')).toBe(false)
    expect(all.some((e) => e.backup_id === 'b2')).toBe(true)
  })
})
