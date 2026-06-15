// Agents-domain usage metrics — mirrors Rust agents::domain::usage_metrics.
// Field-for-field aligned with contexts/usage UsageRecord, but agentId is the
// strongly-typed AgentId (snake_case) rather than a free string. The usage
// context maps these into its own persistence records.

import type { AgentId } from './agent-id'

/** Normalized usage record produced by a SessionLogReader. */
export interface UsageRecord {
  agentId: AgentId
  sourceKind: string
  sourcePath: string
  sourceEventId: string
  sessionId?: string | undefined
  model: string
  providerName?: string | undefined
  /** Token counts are u64 in Rust; non-negative integers here. */
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  /** Unix seconds (i64 in Rust). */
  occurredAt: number
  rawUpdatedAt: number
  /** 16-char hex fingerprint of the raw source line/object (dedup, non-crypto). */
  rawHash: string
}

/**
 * Cursor for incremental reads. Default is the zero value; all current adapters
 * do full scans and return the default, mirroring the source.
 */
export interface UsageCursor {
  sourcePath: string
  lastOffset: number
  lastModifiedNs: number
}

export function defaultUsageCursor(): UsageCursor {
  return { sourcePath: '', lastOffset: 0, lastModifiedNs: 0 }
}

/** Batch returned by SessionLogReader.readUsageMetrics. */
export interface UsageMetricsBatch {
  records: UsageRecord[]
  nextCursor: UsageCursor
}
