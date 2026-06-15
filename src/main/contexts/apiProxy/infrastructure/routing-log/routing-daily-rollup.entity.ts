/**
 * MikroORM 实体：routing_daily_rollups（路由日志分析模块的日桶聚合）。
 * 复合主键 (date, platform, comboName)；platform/comboName 用 '' 归一空值（主键不可 NULL）。
 * 由 RoutingLogService 在落库后按受影响日期增量重建（DELETE 那几天 + 从明细 GROUP BY 重插）。
 * 保留期比明细更久，使天级趋势在明细被清理后仍可回看长期走势。
 */
import { Entity, PrimaryKey, Property } from '@mikro-orm/core'

@Entity({ tableName: 'routing_daily_rollups' })
export class RoutingDailyRollupEntity {
  /** YYYY-MM-DD（localtime）。 */
  @PrimaryKey({ type: 'text' })
  date!: string

  /** 命中平台；空归一为 ''。 */
  @PrimaryKey({ type: 'text' })
  platform!: string

  @PrimaryKey({ type: 'text', fieldName: 'combo_name' })
  comboName!: string

  @Property({ type: 'integer', fieldName: 'records_count' })
  recordsCount!: number

  @Property({ type: 'integer', fieldName: 'success_count' })
  successCount!: number

  @Property({ type: 'integer', fieldName: 'failed_count' })
  failedCount!: number

  @Property({ type: 'bigint', fieldName: 'sum_duration_ms' })
  sumDurationMs!: number

  @Property({ type: 'bigint', fieldName: 'input_tokens' })
  inputTokens!: number

  @Property({ type: 'bigint', fieldName: 'output_tokens' })
  outputTokens!: number

  @Property({ type: 'bigint', fieldName: 'updated_at' })
  updatedAt!: number
}
