// analytics 上下文 DTO（统一用量统计 · usage_events 单表查询）。

/** 查询窗口：epoch 秒闭区间。 */
export interface AnalyticsWindowDto {
  startSec: number
  endSec: number
}

/** 概览汇总。 */
export interface AnalyticsSummaryDto {
  totalTokens: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  requests: number
  totalCostUsd: number
  cacheHitRate: number
}

/** 趋势单点。 */
export interface AnalyticsTrendPointDto {
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
export interface AgentBreakdownDto {
  agentId: string
  totalTokens: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  requests: number
  totalCostUsd: number
  shareRatio: number
  cacheHitRate: number
}

/** 模型维度下钻行。 */
export interface ModelBreakdownDto {
  model: string
  requests: number
  totalTokens: number
  inputTokens: number
  outputTokens: number
  totalCostUsd: number
  avgCostUsd: number
  shareRatio: number
}

/** 明细检索过滤。 */
export interface UsageEventSearchFilterDto {
  agentId?: string
  model?: string
  source?: 'proxy' | 'session'
  statusClass?: '2xx' | '4xx' | '5xx'
  keyword?: string
}

/** keyset 分页游标。 */
export interface UsageEventCursorDto {
  occurredAt: number
  requestId: string
}

/** 明细行。 */
export interface UsageEventRowDto {
  requestId: string
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

/** 检索分页结果。 */
export interface UsageEventSearchPageDto {
  rows: UsageEventRowDto[]
  nextCursor?: UsageEventCursorDto
}

/** 模型定价行。 */
export interface ModelPricingDto {
  modelId: string
  displayName: string
  inputCostPerMillion: number
  outputCostPerMillion: number
  cacheReadCostPerMillion: number
  cacheCreationCostPerMillion: number
}

/** per-agent 定价配置。 */
export interface PricingConfigDto {
  agentId: string
  costMultiplier: number
  pricingModelSource: 'request' | 'response'
}
