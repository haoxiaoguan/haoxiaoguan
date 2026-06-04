// activity-event.entity.ts
import { Entity, PrimaryKey, Property } from '@mikro-orm/core'

@Entity({ tableName: 'activity_events' })
export class ActivityEventEntity {
  @PrimaryKey({ type: 'text', fieldName: 'source_key' })
  sourceKey!: string

  @Property({ type: 'text' })
  tool!: string

  @Property({ type: 'text' })
  metric!: string

  /** epoch 秒 */
  @Property({ type: 'bigint', fieldName: 'occurred_at' })
  occurredAt!: number
}
