/**
 * MikroORM 实体：analytics_meta（analytics 上下文的一次性维护标志位 / KV）。
 *
 * ⚠️ 必须注册为实体：否则 createSchema 的 updateSchema 会把这张"未知表"在每次启动时清掉/重建，
 * 一次性守卫(全量重读/proxy 回填)标志位永远存不住 → 每次启动都重跑全量重读。
 * 注册后等同 usage_sync_state 等实体表，schema 生成器会保留其数据。
 */
import { Entity, PrimaryKey, Property } from '@mikro-orm/core'

@Entity({ tableName: 'analytics_meta' })
export class AnalyticsMetaEntity {
  @PrimaryKey({ type: 'text', fieldName: 'key' })
  key!: string

  @Property({ type: 'text', fieldName: 'value' })
  value!: string
}
