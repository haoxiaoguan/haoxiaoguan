// MikroORM entity for the skill_backups table.
// Mirrors Rust sea-orm entity exactly: TEXT PK, INTEGER timestamp.

import { Entity, PrimaryKey, Property } from '@mikro-orm/core'

@Entity({ tableName: 'skill_backups' })
export class SkillBackupEntity {
  @PrimaryKey({ type: 'text' })
  backup_id!: string

  @Property({ type: 'text' })
  skill_id!: string

  @Property({ type: 'text' })
  snapshot_json!: string

  @Property({ type: 'text' })
  archive_path!: string

  @Property({ type: 'bigint' })
  created_at!: number
}
