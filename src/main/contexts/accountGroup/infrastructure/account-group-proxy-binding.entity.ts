import { Entity, PrimaryKey, Property } from '@mikro-orm/core'

// account_group_proxy_bindings — at-most-one outbound proxy per account-group.
// group_id is the PRIMARY KEY so re-binding upserts the row without duplication.
// When a group is bound, every member account routes through proxy_id unless the
// account has its own per-account proxy binding (which takes precedence).

@Entity({ tableName: 'account_group_proxy_bindings' })
export class AccountGroupProxyBindingEntity {
  @PrimaryKey({ type: 'string', fieldName: 'group_id' })
  groupId!: string

  @Property({ type: 'string', fieldName: 'proxy_id', nullable: true })
  proxyId?: string | null

  @Property({ type: 'string', fieldName: 'created_at' })
  createdAt!: string
}
