// MikroORM entity for the skill_repos table.
// Composite PK: (owner, name). Mirrors Rust sea-orm entity exactly.

import { Entity, PrimaryKey, Property } from '@mikro-orm/core'

@Entity({ tableName: 'skill_repos' })
export class SkillRepoEntity {
  @PrimaryKey({ type: 'text' })
  owner!: string

  @PrimaryKey({ type: 'text' })
  name!: string

  @Property({ type: 'text' })
  branch!: string

  @Property({ type: 'boolean' })
  enabled!: boolean

  @Property({ type: 'integer' })
  sort_order!: number

  @Property({ type: 'bigint' })
  added_at!: number
}
