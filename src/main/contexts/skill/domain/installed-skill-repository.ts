// InstalledSkillRepository -- port (interface) for the installed_skills table.

import type { InstalledSkill } from './installed-skill'

export interface InstalledSkillRepository {
  findAll(): Promise<InstalledSkill[]>
  findById(id: string): Promise<InstalledSkill | undefined>
  findByDirectory(directory: string): Promise<InstalledSkill | undefined>
  /** Upsert: insert or replace on id conflict. */
  save(skill: InstalledSkill): Promise<void>
  delete(id: string): Promise<void>
}
