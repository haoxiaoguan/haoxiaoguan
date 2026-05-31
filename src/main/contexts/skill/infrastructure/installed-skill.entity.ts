// MikroORM entity for the installed_skills table.
// Mirrors Rust sea-orm entity exactly: TEXT PK, INTEGER timestamps (Unix seconds).
// apps_json is stored as TEXT (JSON string) -- NOT type:'json' -- because the
// domain layer owns serialisation (InstalledSkill.appsToJson / appsFromJson).

import { Entity, PrimaryKey, Property } from '@mikro-orm/core'

@Entity({ tableName: 'installed_skills' })
export class InstalledSkillEntity {
  @PrimaryKey({ type: 'text' })
  id!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text', nullable: true })
  description?: string

  @Property({ type: 'text' })
  directory!: string

  @Property({ type: 'text', nullable: true })
  repo_owner?: string

  @Property({ type: 'text', nullable: true })
  repo_name?: string

  @Property({ type: 'text', nullable: true })
  repo_branch?: string

  @Property({ type: 'text', nullable: true })
  readme_url?: string

  /** JSON string: Record<AgentId, boolean> */
  @Property({ type: 'text' })
  apps_json!: string

  @Property({ type: 'bigint' })
  installed_at!: number

  @Property({ type: 'bigint' })
  updated_at!: number

  @Property({ type: 'text', nullable: true })
  content_hash?: string

  @Property({ type: 'text' })
  ssot_path!: string

  @Property({ type: 'text' })
  storage_location!: string
}
