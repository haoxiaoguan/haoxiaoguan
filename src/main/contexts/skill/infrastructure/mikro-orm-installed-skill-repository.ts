// MikroORM-backed implementation of InstalledSkillRepository.
// Uses raw SQL via the underlying connection (same pattern as usage repositories)
// so that entity decorator files are not imported at test time -- vitest/esbuild
// cannot process emitDecoratorMetadata.
// Accepts an optional getEm factory for testability.

import type { EntityManager } from '@mikro-orm/better-sqlite'
import { getEm as defaultGetEm } from '../../../platform/persistence/database'
import type { InstalledSkillRepository } from '../domain/installed-skill-repository'
import { InstalledSkill } from '../domain/installed-skill'

interface SkillRow {
  id: string
  name: string
  description: string | null
  directory: string
  repo_owner: string | null
  repo_name: string | null
  repo_branch: string | null
  readme_url: string | null
  apps_json: string
  installed_at: number
  updated_at: number
  content_hash: string | null
  ssot_path: string
  storage_location: string
}

function rowToDomain(row: SkillRow): InstalledSkill {
  return InstalledSkill.create({
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    directory: row.directory,
    repo_owner: row.repo_owner ?? undefined,
    repo_name: row.repo_name ?? undefined,
    repo_branch: row.repo_branch ?? undefined,
    readme_url: row.readme_url ?? undefined,
    apps: InstalledSkill.appsFromJson(row.apps_json),
    installed_at: Number(row.installed_at),
    updated_at: Number(row.updated_at),
    content_hash: row.content_hash ?? undefined,
    ssot_path: row.ssot_path,
    storage_location: row.storage_location === 'agent' ? 'agent' : 'haoxiaoguan',
  })
}

export class MikroOrmInstalledSkillRepository implements InstalledSkillRepository {
  private readonly getEm: () => EntityManager

  constructor(getEmFn?: () => EntityManager) {
    this.getEm = getEmFn ?? defaultGetEm
  }

  async findAll(): Promise<InstalledSkill[]> {
    const conn = this.getEm().getConnection()
    const rows = await conn.execute('SELECT * FROM installed_skills') as SkillRow[]
    return rows.map(rowToDomain)
  }

  async findById(id: string): Promise<InstalledSkill | undefined> {
    const conn = this.getEm().getConnection()
    const rows = await conn.execute('SELECT * FROM installed_skills WHERE id = ?', [id]) as SkillRow[]
    return rows[0] ? rowToDomain(rows[0]) : undefined
  }

  async findByDirectory(directory: string): Promise<InstalledSkill | undefined> {
    const conn = this.getEm().getConnection()
    const rows = await conn.execute('SELECT * FROM installed_skills WHERE directory = ?', [directory]) as SkillRow[]
    return rows[0] ? rowToDomain(rows[0]) : undefined
  }

  async save(skill: InstalledSkill): Promise<void> {
    const conn = this.getEm().getConnection()
    await conn.execute(
      `INSERT INTO installed_skills
        (id, name, description, directory, repo_owner, repo_name, repo_branch,
         readme_url, apps_json, installed_at, updated_at, content_hash, ssot_path, storage_location)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         description = excluded.description,
         directory = excluded.directory,
         repo_owner = excluded.repo_owner,
         repo_name = excluded.repo_name,
         repo_branch = excluded.repo_branch,
         readme_url = excluded.readme_url,
         apps_json = excluded.apps_json,
         installed_at = excluded.installed_at,
         updated_at = excluded.updated_at,
         content_hash = excluded.content_hash,
         ssot_path = excluded.ssot_path,
         storage_location = excluded.storage_location`,
      [
        skill.id,
        skill.name,
        skill.description ?? null,
        skill.directory,
        skill.repo_owner ?? null,
        skill.repo_name ?? null,
        skill.repo_branch ?? null,
        skill.readme_url ?? null,
        skill.appsToJson(),
        skill.installed_at,
        skill.updated_at,
        skill.content_hash ?? null,
        skill.ssot_path,
        skill.storage_location,
      ],
    )
  }

  async delete(id: string): Promise<void> {
    const conn = this.getEm().getConnection()
    await conn.execute('DELETE FROM installed_skills WHERE id = ?', [id])
  }
}
