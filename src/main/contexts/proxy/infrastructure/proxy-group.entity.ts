import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/core'

// proxy_groups table — a named set of accounts that share one proxy.
// proxy_id references proxies.id (FK enforced at the app layer / delete-protection
// in the repository, not via a hard ON DELETE so we can surface a clear
// "still in use" error rather than silently cascading).

@Entity({ tableName: 'proxy_groups' })
@Index({ name: 'idx_proxy_groups_proxy', properties: ['proxyId'] })
export class ProxyGroupEntity {
  @PrimaryKey({ type: 'string', fieldName: 'id' })
  id!: string

  @Property({ type: 'string', fieldName: 'name' })
  name!: string

  @Property({ type: 'string', fieldName: 'proxy_id' })
  proxyId!: string

  @Property({ type: 'string', fieldName: 'created_at' })
  createdAt!: string
}
