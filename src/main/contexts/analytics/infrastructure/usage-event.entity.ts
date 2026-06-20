/**
 * MikroORM 实体：usage_events（统一用量明细表）。
 *
 * analytics 上下文的唯一数据源，双源写入：
 *   - source='proxy'：代理层实时请求（RoutingObservabilityService.enqueue 后追加写入）
 *   - source='session'：会话日志扫描（UsageSyncService.syncAll 后追加写入）
 *
 * session 源写入前按 dedup_id + 指纹去重，避免走代理的请求被日志扫描重复计入。
 * occurred_at 为 Unix 秒（与 usage_records.occurred_at 同口径）。
 *
 * 索引覆盖：窗口过滤 (occurred_at)、agent 维度下钻 (agent_id, occurred_at)、
 * 去重查询 (dedup_id)、模型维度聚合 (model, occurred_at)。
 */
import { Entity, PrimaryKey, Property, Index } from '@mikro-orm/core'

@Entity({ tableName: 'usage_events' })
@Index({ properties: ['occurredAt'] })
@Index({ properties: ['agentId', 'occurredAt'] })
@Index({ properties: ['dedupId'] })
@Index({ properties: ['model', 'occurredAt'] })
export class UsageEventEntity {
  @PrimaryKey({ type: 'integer', autoincrement: true })
  id!: number

  /** 去重键：代理源用稳定 requestId；会话源用 `session:{sourceEventId}`。 */
  @Property({ type: 'text', fieldName: 'dedup_id' })
  dedupId!: string

  /** 数据来源：'proxy' / 'session'。 */
  @Property({ type: 'text', fieldName: 'source' })
  source!: string

  /** agent 客户端：claude / codex / gemini-cli / kiro / qoder / unknown。 */
  @Property({ type: 'text', fieldName: 'agent_id' })
  agentId!: string

  @Property({ type: 'text', nullable: true })
  model?: string

  /** 客户端请求的原始模型（仅 proxy 源）。 */
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

  /** HTTP 状态（仅 proxy 源）。 */
  @Property({ type: 'integer', nullable: true })
  status?: number

  /** 请求耗时毫秒（仅 proxy 源）。 */
  @Property({ type: 'integer', fieldName: 'duration_ms', nullable: true })
  durationMs?: number

  /** 首字节延迟毫秒（仅 proxy 源）。 */
  @Property({ type: 'integer', fieldName: 'ttfb_ms', nullable: true })
  ttfbMs?: number

  /** 错误分类（仅 proxy 源）。 */
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

  /** 发生时间（Unix 秒）。 */
  @Property({ type: 'bigint', fieldName: 'occurred_at' })
  occurredAt!: number

  /** 写入时间（Unix 秒）。 */
  @Property({ type: 'bigint', fieldName: 'created_at' })
  createdAt!: number
}
