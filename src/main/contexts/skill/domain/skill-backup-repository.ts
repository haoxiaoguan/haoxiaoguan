// SkillBackupRepository -- port (interface) for the skill_backups table.

import type { SkillBackupEntry } from './skill-backup'

export interface SkillBackupRepository {
  /** Returns all backups ordered by created_at DESC. */
  findAll(): Promise<SkillBackupEntry[]>
  findBySkillId(skillId: string): Promise<SkillBackupEntry[]>
  save(entry: SkillBackupEntry): Promise<void>
  delete(backupId: string): Promise<void>
}
