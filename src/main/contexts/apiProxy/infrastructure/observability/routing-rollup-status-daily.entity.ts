/**
 * MikroORM 实体：routing_rollup_status_daily（状态类维度日桶）。
 * 复合主键 (date, statusClass)，statusClass ∈ 2xx/3xx/4xx/5xx/other。按 batch 增量 UPSERT 累加。
 * 让「按状态类」的长期趋势在明细被清理后仍可回看（修 P5）。
 */
import { Entity, PrimaryKey, Property } from '@mikro-orm/core'

@Entity({ tableName: 'routing_rollup_status_daily' })
export class RoutingRollupStatusDailyEntity {
  /** YYYY-MM-DD（localtime）。 */
  @PrimaryKey({ type: 'text' })
  date!: string

  /** 状态类：2xx/3xx/4xx/5xx/other。 */
  @PrimaryKey({ type: 'text', fieldName: 'status_class' })
  statusClass!: string

  @Property({ type: 'integer', fieldName: 'records_count' })
  recordsCount!: number

  @Property({ type: 'bigint', fieldName: 'sum_duration_ms' })
  sumDurationMs!: number

  @Property({ type: 'bigint', fieldName: 'sum_ttfb_ms' })
  sumTtfbMs!: number

  @Property({ type: 'bigint', fieldName: 'input_tokens' })
  inputTokens!: number

  @Property({ type: 'bigint', fieldName: 'output_tokens' })
  outputTokens!: number

  @Property({ type: 'bigint', fieldName: 'updated_at' })
  updatedAt!: number
}
