// activity-daily-rollup.entity.ts
import { Entity, PrimaryKey, Property } from '@mikro-orm/core'

@Entity({ tableName: 'activity_daily_rollups' })
export class ActivityDailyRollupEntity {
  /** YYYY-MM-DD (UTC) */
  @PrimaryKey({ type: 'text' })
  date!: string

  @PrimaryKey({ type: 'text' })
  tool!: string

  @PrimaryKey({ type: 'text' })
  metric!: string

  @Property({ type: 'integer' })
  value!: number

  @Property({ type: 'bigint', fieldName: 'updated_at' })
  updatedAt!: number
}
