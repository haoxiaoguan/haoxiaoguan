/**
 * analytics 上下文领域模型与查询返回类型。
 * 纯类型，无 I/O。对应 usage_events 表的领域投影。
 */

/** 统一用量事件（对应 usage_events 单行）。 */
export interface UsageEvent {
  id?: number
  dedupId: string
  source: 'proxy' | 'session'
  agentId: string
  model?: string
  requestedModel?: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  inputCostUsd: number
  outputCostUsd: number
  cacheReadCostUsd: number
  cacheCreationCostUsd: number
  totalCostUsd: number
  status?: number
  durationMs?: number
  ttfbMs?: number
  errorKind?: string
  accountId?: string
  clientKeyId?: string
  comboName?: string
  sessionId?: string
  occurredAt: number
  createdAt: number
}

/** 查询窗口：epoch 秒闭区间。 */
export interface UsageEventWindow {
  startSec: number
  endSec: number
}

/** 趋势粒度：hour 走秒桶；day 走日桶。 */
export type UsageEventGranularity = 'hour' | 'day'

/** 趋势指标。 */
export type UsageEventTrendMetric = 'tokens' | 'cost' | 'requests'

/** 概览汇总（窗口内整体）。 */
export interface UsageEventSummary {
  totalTokens: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  requests: number
  totalCostUsd: number
  /** 缓存命中率：cacheRead / (input + cacheRead + cacheCreation)，0..1。 */
  cacheHitRate: number
}

/** 趋势单点。 */
export interface UsageEventTrendPoint {
  date: string
  totalTokens: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  requests: number
  costUsd: number
}

/** agent 维度下钻行。 */
export interface AgentBreakdownRow {
  agentId: string
  totalTokens: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  requests: number
  totalCostUsd: number
  /** 占窗口总 token 比 0..1。 */
  shareRatio: number
  /** 缓存命中率 0..1。 */
  cacheHitRate: number
}

/** 模型维度下钻行。 */
export interface ModelBreakdownRow {
  model: string
  requests: number
  totalTokens: number
  inputTokens: number
  outputTokens: number
  totalCostUsd: number
  /** 平均单次请求成本。 */
  avgCostUsd: number
  /** 占窗口总 token 比 0..1。 */
  shareRatio: number
}

/** 明细检索过滤。 */
export interface UsageEventSearchFilter {
  agentId?: string
  model?: string
  source?: 'proxy' | 'session'
  /** 状态类筛选（仅对 proxy 源有意义）。 */
  statusClass?: '2xx' | '4xx' | '5xx'
  /** 关键字（对 model / requestedModel 做 LIKE）。 */
  keyword?: string
}

/** keyset 分页游标（按 (occurred_at, id) 降序）。 */
export interface UsageEventCursor {
  occurredAt: number
  id: number
}

/** 明细行（落库投影 + 主键 id）。 */
export interface UsageEventRow extends UsageEvent {
  id: number
}

/** 检索分页结果。 */
export interface UsageEventSearchPage {
  rows: UsageEventRow[]
  nextCursor?: UsageEventCursor
}

/** 定价行（从 DB 读取后的内存表示）。 */
export interface ModelPricingRow {
  modelId: string
  displayName: string
  inputCostPerMillion: number
  outputCostPerMillion: number
  cacheReadCostPerMillion: number
  cacheCreationCostPerMillion: number
}

/** per-agent 定价配置。 */
export interface PricingConfig {
  agentId: string
  costMultiplier: number
  pricingModelSource: 'request' | 'response'
}
