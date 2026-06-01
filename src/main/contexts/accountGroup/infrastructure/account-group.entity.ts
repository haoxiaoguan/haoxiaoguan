import { Entity, PrimaryKey, Property, Unique } from '@mikro-orm/core'

// account_groups — cross-platform account groupings.
// Timestamps are RFC3339 strings to match the rest of the schema convention.

@Entity({ tableName: 'account_groups' })
@Unique({ name: 'idx_account_groups_name', properties: ['name'] })
export class AccountGroupEntity {
  @PrimaryKey({ type: 'string', fieldName: 'id' })
  id!: string

  @Property({ type: 'string', fieldName: 'name' })
  name!: string

  @Property({ type: 'string', fieldName: 'color', nullable: true })
  color?: string | null

  @Property({ type: 'string', fieldName: 'description', nullable: true })
  description?: string | null

  @Property({ type: 'string', fieldName: 'created_at' })
  createdAt!: string

  @Property({ type: 'string', fieldName: 'updated_at' })
  updatedAt!: string
}
