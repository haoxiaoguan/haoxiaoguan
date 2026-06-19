/**
 * MikroORM 实体：routing_rollup_account_daily（账号维度日桶）。
 * 复合主键 (date, accountId)；accountId 用 '' 归一空值。按 batch 增量 UPSERT 累加。
 * 额外含 rate_limited_count（429 次数），供账号池健康长期视图（修 P5）。
 */
import { Entity, PrimaryKey, Property } from '@mikro-orm/core'

@Entity({ tableName: 'routing_rollup_account_daily' })
export class RoutingRollupAccountDailyEntity {
  /** YYYY-MM-DD（localtime）。 */
  @PrimaryKey({ type: 'text' })
  date!: string

  /** 服务该请求的账号 id；空归一为 ''。 */
  @PrimaryKey({ type: 'text', fieldName: 'account_id' })
  accountId!: string

  @Property({ type: 'integer', fieldName: 'records_count' })
  recordsCount!: number

  @Property({ type: 'integer', fieldName: 'success_count' })
  successCount!: number

  @Property({ type: 'integer', fieldName: 'failed_count' })
  failedCount!: number

  /** 命中 429（限流）的次数。 */
  @Property({ type: 'integer', fieldName: 'rate_limited_count' })
  rateLimitedCount!: number

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
