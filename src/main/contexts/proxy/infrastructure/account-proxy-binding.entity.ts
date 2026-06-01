import { Entity, PrimaryKey, Property } from '@mikro-orm/core'

// account_proxy_bindings table — an account maps to at most ONE proxy directly
// (proxy_id). account_id is the PRIMARY KEY so the binding is inherently unique
// per account (re-binding upserts the single row).

@Entity({ tableName: 'account_proxy_bindings' })
export class AccountProxyBindingEntity {
  @PrimaryKey({ type: 'string', fieldName: 'account_id' })
  accountId!: string

  @Property({ type: 'string', fieldName: 'proxy_id', nullable: true })
  proxyId?: string | null

  @Property({ type: 'string', fieldName: 'created_at' })
  createdAt!: string
}
