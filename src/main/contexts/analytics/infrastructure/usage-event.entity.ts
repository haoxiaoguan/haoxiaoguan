/**
 * MikroORM 实体：usage_events（统一用量明细表）。
 * 参照 cc-switch proxy_request_logs：request_id 做主键，天然去重。
 *   - proxy 源：request_id 用 UUID
 *   - session 源：request_id = 'session:{sourceEventId}'
 */
import { Entity, PrimaryKey, Property, Index } from '@mikro-orm/core'

@Entity({ tableName: 'usage_events' })
@Index({ properties: ['occurredAt'] })
@Index({ properties: ['agentId', 'occurredAt'] })
@Index({ properties: ['model', 'occurredAt'] })
export class UsageEventEntity {
  @PrimaryKey({ type: 'text', fieldName: 'request_id' })
  requestId!: string

  @Property({ type: 'text', fieldName: 'source' })
  source!: string

  @Property({ type: 'text', fieldName: 'agent_id' })
  agentId!: string

  @Property({ type: 'text', nullable: true })
  model?: string

  @Property({ type: 'text', fieldName: 'requested_model', nullable: true })
  requestedModel?: string

  @Property({ type: 'integer', fieldName: 'input_tokens' })
  inputTokens!: number

  @Property({ type: 'integer', fieldName: 'output_tokens' })
  outputTokens!: number

  @Property({ type: 'integer', fieldName: 'cache_read_tokens' })
  cacheReadTokens!: number

  @Property({ type: 'integer', fieldName: 'cache_creation_tokens' })
  cacheCreationTokens!: number

  @Property({ type: 'real', fieldName: 'input_cost_usd' })
  inputCostUsd!: number

  @Property({ type: 'real', fieldName: 'output_cost_usd' })
  outputCostUsd!: number

  @Property({ type: 'real', fieldName: 'cache_read_cost_usd' })
  cacheReadCostUsd!: number

  @Property({ type: 'real', fieldName: 'cache_creation_cost_usd' })
  cacheCreationCostUsd!: number

  @Property({ type: 'real', fieldName: 'total_cost_usd' })
  totalCostUsd!: number

  @Property({ type: 'integer', nullable: true })
  status?: number

  @Property({ type: 'integer', fieldName: 'duration_ms', nullable: true })
  durationMs?: number

  @Property({ type: 'integer', fieldName: 'ttfb_ms', nullable: true })
  ttfbMs?: number

  @Property({ type: 'text', fieldName: 'error_kind', nullable: true })
  errorKind?: string

  @Property({ type: 'text', fieldName: 'account_id', nullable: true })
  accountId?: string

  @Property({ type: 'text', fieldName: 'client_key_id', nullable: true })
  clientKeyId?: string

  @Property({ type: 'text', fieldName: 'combo_name', nullable: true })
  comboName?: string

  @Property({ type: 'text', fieldName: 'session_id', nullable: true })
  sessionId?: string

  @Property({ type: 'bigint', fieldName: 'occurred_at' })
  occurredAt!: number

  @Property({ type: 'bigint', fieldName: 'created_at' })
  createdAt!: number
}
