import { Entity, PrimaryKey, Property } from '@mikro-orm/core'

// account_proxy_bindings table — multi-to-one resolution: an account maps to at
// most ONE proxy, directly (proxy_id) or via a group (group_id). account_id is
// the PRIMARY KEY so the binding is inherently unique per account (re-binding
// upserts the single row). Exactly one of proxy_id / group_id is non-null.

@Entity({ tableName: 'account_proxy_bindings' })
export class AccountProxyBindingEntity {
  @PrimaryKey({ type: 'string', fieldName: 'account_id' })
  accountId!: string

  @Property({ type: 'string', fieldName: 'proxy_id', nullable: true })
  proxyId?: string | null

  @Property({ type: 'string', fieldName: 'group_id', nullable: true })
  groupId?: string | null

  @Property({ type: 'string', fieldName: 'created_at' })
  createdAt!: string
}
