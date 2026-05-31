// MikroORM-backed implementation of SkillRepoRepository.
// Uses raw SQL via the underlying connection (no entity class imports).
// Upsert on composite PK (owner, name) via ON CONFLICT DO UPDATE.
// Accepts an optional getEm factory for testability.

import type { EntityManager } from '@mikro-orm/better-sqlite'
import { getEm as defaultGetEm } from '../../../platform/persistence/database'
import type { SkillRepoRepository } from '../domain/skill-repo-repository'
import { SkillRepo } from '../domain/skill-repo'

interface RepoRow {
  owner: string
  name: string
  branch: string
  enabled: number | boolean
  sort_order: number
  added_at: number
}

function rowToDomain(row: RepoRow): SkillRepo {
  return SkillRepo.create({
    owner: row.owner,
    name: row.name,
    branch: row.branch,
    enabled: Boolean(row.enabled),
    sort_order: Number(row.sort_order),
    added_at: Number(row.added_at),
  })
}

export class MikroOrmSkillRepoRepository implements SkillRepoRepository {
  private readonly getEm: () => EntityManager

  constructor(getEmFn?: () => EntityManager) {
    this.getEm = getEmFn ?? defaultGetEm
  }

  async findAll(): Promise<SkillRepo[]> {
    const conn = this.getEm().getConnection()
    const rows = await conn.execute('SELECT * FROM skill_repos ORDER BY sort_order ASC') as RepoRow[]
    return rows.map(rowToDomain)
  }

  async findEnabled(): Promise<SkillRepo[]> {
    const conn = this.getEm().getConnection()
    const rows = await conn.execute('SELECT * FROM skill_repos WHERE enabled = 1 ORDER BY sort_order ASC') as RepoRow[]
    return rows.map(rowToDomain)
  }

  async save(repo: SkillRepo): Promise<void> {
    const conn = this.getEm().getConnection()
    await conn.execute(
      `INSERT INTO skill_repos (owner, name, branch, enabled, sort_order, added_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(owner, name) DO UPDATE SET
         branch = excluded.branch,
         enabled = excluded.enabled,
         sort_order = excluded.sort_order,
         added_at = excluded.added_at`,
      [repo.owner, repo.name, repo.branch, repo.enabled ? 1 : 0, repo.sort_order, repo.added_at],
    )
  }

  async delete(owner: string, name: string): Promise<void> {
    const conn = this.getEm().getConnection()
    await conn.execute('DELETE FROM skill_repos WHERE owner = ? AND name = ?', [owner, name])
  }
}
