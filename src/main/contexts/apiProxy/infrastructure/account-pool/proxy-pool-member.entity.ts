/**
 * MikroORM 实体：proxy_pool_members（反代账号池成员标识）。
 * 「账号池」是一个独立标识：账号必须在本表中（= 拥有该标识）才被反代选号纳入候选。
 * 单表单列主键：accountId。与 account 上下文解耦（不在 accounts 表上加列）。
 */
import { Entity, PrimaryKey, Property } from '@mikro-orm/core'

@Entity({ tableName: 'proxy_pool_members' })
export class ProxyPoolMemberEntity {
  @PrimaryKey({ type: 'text', fieldName: 'account_id' })
  accountId!: string

  /** 选号权重优先级（越大占比越高；默认 0）。updateSchema 在存量库上自动 ADD COLUMN。 */
  @Property({ type: 'integer', default: 0 })
  priority: number = 0

  /** 每账号并发上限（同时在途请求数；默认 4）。updateSchema 在存量库上自动 ADD COLUMN。 */
  @Property({ type: 'integer', default: 4 })
  concurrency: number = 4

  @Property({ type: 'bigint', fieldName: 'created_at' })
  createdAt!: number
}
