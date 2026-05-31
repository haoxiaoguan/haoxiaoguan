// SkillBackupEntry entity -- mirrors Rust modules::skill::domain::skill_backup.
// snapshot_json must be valid InstalledSkill JSON for restore to succeed.
// archive_path points to ~/.haoxiaoguan/backups/skills/{directory}_{backup_id}.json

export class SkillBackupEntry {
  private constructor(
    public readonly backup_id: string,
    public readonly skill_id: string,
    public readonly snapshot_json: string,
    public readonly archive_path: string,
    public readonly created_at: number,
  ) {
    if (!backup_id) throw new Error('SkillBackupEntry: backup_id is required')
    if (!skill_id) throw new Error('SkillBackupEntry: skill_id is required')
    if (!snapshot_json) throw new Error('SkillBackupEntry: snapshot_json is required')
    if (!archive_path) throw new Error('SkillBackupEntry: archive_path is required')
  }

  static create(params: {
    backup_id: string
    skill_id: string
    snapshot_json: string
    archive_path: string
    created_at: number
  }): SkillBackupEntry {
    return new SkillBackupEntry(
      params.backup_id,
      params.skill_id,
      params.snapshot_json,
      params.archive_path,
      params.created_at,
    )
  }
}
