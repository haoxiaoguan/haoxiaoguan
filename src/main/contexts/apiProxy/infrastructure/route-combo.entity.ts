import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/core'

// route_combos table — owned by the apiProxy context.
//
// 路由组合（命名的跨供应商降级链）。steps_json 是 JSON 字符串，形如
// [{"model":"kr/claude-sonnet-4.5","enabled":true}, ...]，数组顺序即优先级。
// name 唯一（作为可路由 model 名）。时间戳为 RFC3339 字符串，沿用全仓约定。
@Entity({ tableName: 'route_combos' })
@Index({ name: 'idx_route_combo_name', properties: ['name'] })
export class RouteComboEntity {
  @PrimaryKey({ type: 'string', fieldName: 'id' })
  id!: string

  @Property({ type: 'string', fieldName: 'name' })
  @Index({ name: 'uniq_route_combo_name' })
  name!: string

  @Property({ type: 'string', fieldName: 'description', nullable: true })
  description?: string | null

  /** JSON: ComboStep[]（{model, enabled?}）。 */
  @Property({ type: 'string', fieldName: 'steps_json' })
  stepsJson!: string

  @Property({ type: 'string', fieldName: 'strategy' })
  strategy!: string

  @Property({ type: 'boolean', fieldName: 'enabled' })
  enabled!: boolean

  @Property({ type: 'string', fieldName: 'created_at' })
  createdAt!: string

  @Property({ type: 'string', fieldName: 'updated_at' })
  updatedAt!: string
}
