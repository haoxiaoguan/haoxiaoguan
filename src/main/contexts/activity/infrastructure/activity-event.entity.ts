// activity-event.entity.ts
import { Entity, PrimaryKey, Property } from '@mikro-orm/core'

@Entity({ tableName: 'activity_events' })
export class ActivityEventEntity {
  @PrimaryKey({ type: 'text', fieldName: 'source_key' })
  sourceKey!: string

  @PrimaryKey({ type: 'text' })
  metric!: string

  @Property({ type: 'text' })
  tool!: string

  /** epoch 秒 */
  @Property({ type: 'bigint', fieldName: 'occurred_at' })
  occurredAt!: number

  /** 求和量（缺省 1） */
  @Property({ type: 'integer', default: 1 })
  amount!: number
}
