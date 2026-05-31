/**
 * MikroORM entity for usage_daily_rollups table.
 * Composite PK: (date, agent_id, source_kind).
 * NOTE: The Rust rollup SQL used a legacy column name "platform" but the migration
 * defines it as "agent_id". We use agent_id as the canonical column name here.
 */
import { Entity, PrimaryKey, Property } from '@mikro-orm/core'

@Entity({ tableName: 'usage_daily_rollups' })
export class UsageDailyRollupEntity {
  /** YYYY-MM-DD */
  @PrimaryKey({ type: 'text' })
  date!: string

  @PrimaryKey({ type: 'text', fieldName: 'agent_id' })
  agentId!: string

  @PrimaryKey({ type: 'text', fieldName: 'source_kind' })
  sourceKind!: string

  @Property({ type: 'integer', fieldName: 'records_count' })
  recordsCount!: number

  @Property({ type: 'bigint', fieldName: 'input_tokens' })
  inputTokens!: number

  @Property({ type: 'bigint', fieldName: 'output_tokens' })
  outputTokens!: number

  @Property({ type: 'bigint', fieldName: 'cache_read_tokens' })
  cacheReadTokens!: number

  @Property({ type: 'bigint', fieldName: 'cache_creation_tokens' })
  cacheCreationTokens!: number

  @Property({ type: 'bigint', fieldName: 'updated_at' })
  updatedAt!: number
}
