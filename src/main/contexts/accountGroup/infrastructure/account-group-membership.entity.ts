import { Entity, PrimaryKey, Property, Index } from '@mikro-orm/core'

// account_group_memberships — many-to-many between account_groups and accounts.
//
// Composite PK is (group_id, account_id) so an account can join a group at
// most once. We don't add a synthetic surrogate key — the pair is the row.
// MikroORM expresses composite PKs with multiple @PrimaryKey decorators.

@Entity({ tableName: 'account_group_memberships' })
@Index({ name: 'idx_account_group_memberships_account', properties: ['accountId'] })
export class AccountGroupMembershipEntity {
  @PrimaryKey({ type: 'string', fieldName: 'group_id' })
  groupId!: string

  @PrimaryKey({ type: 'string', fieldName: 'account_id' })
  accountId!: string

  @Property({ type: 'string', fieldName: 'created_at' })
  createdAt!: string
}
