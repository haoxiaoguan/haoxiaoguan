// SkillRepoRepository -- port (interface) for the skill_repos table.

import type { SkillRepo } from './skill-repo'

export interface SkillRepoRepository {
  findAll(): Promise<SkillRepo[]>
  /** Returns only repos where enabled = true, ordered by sort_order ASC. */
  findEnabled(): Promise<SkillRepo[]>
  /** Upsert on composite PK (owner, name). */
  save(repo: SkillRepo): Promise<void>
  delete(owner: string, name: string): Promise<void>
}
