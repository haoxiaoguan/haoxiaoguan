/**
 * MikroORM 实体：routing_rollup_model_daily（模型维度日桶）。
 * 复合主键 (date, model)；model 用 '' 归一空值。按 batch 增量 UPSERT 累加。
 * 让「按模型」的长期趋势 / 下钻在明细被清理后仍可回看（修 P5：长期维度丢失）。
 */
import { Entity, PrimaryKey, Property } from '@mikro-orm/core'

@Entity({ tableName: 'routing_rollup_model_daily' })
export class RoutingRollupModelDailyEntity {
  /** YYYY-MM-DD（localtime）。 */
  @PrimaryKey({ type: 'text' })
  date!: string

  /** 最终模型（finalModel；空归一为 ''）。 */
  @PrimaryKey({ type: 'text' })
  model!: string

  @Property({ type: 'integer', fieldName: 'records_count' })
  recordsCount!: number

  @Property({ type: 'integer', fieldName: 'success_count' })
  successCount!: number

  @Property({ type: 'integer', fieldName: 'failed_count' })
  failedCount!: number

  @Property({ type: 'bigint', fieldName: 'sum_duration_ms' })
  sumDurationMs!: number

  @Property({ type: 'bigint', fieldName: 'sum_ttfb_ms' })
  sumTtfbMs!: number

  @Property({ type: 'bigint', fieldName: 'input_tokens' })
  inputTokens!: number

  @Property({ type: 'bigint', fieldName: 'output_tokens' })
  outputTokens!: number

  @Property({ type: 'bigint', fieldName: 'cache_read_tokens' })
  cacheReadTokens!: number

  @Property({ type: 'bigint', fieldName: 'cache_write_tokens' })
  cacheWriteTokens!: number

  @Property({ type: 'bigint', fieldName: 'updated_at' })
  updatedAt!: number
}
