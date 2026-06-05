import { createHash } from 'node:crypto'

// Uniqueness key: (agentId, sourceKind, sourcePath, sourceEventId)
// rawHash is SHA-256 of the raw source line/object for mutation detection.

export class UsageRecord {
  readonly agentId: string
  readonly sourceKind: string
  readonly sourcePath: string
  readonly sourceEventId: string
  readonly sessionId: string | undefined
  readonly model: string
  readonly providerName: string | undefined
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheCreationTokens: number
  /** Unix seconds (i64 in Rust). */
  readonly occurredAt: number
  readonly rawUpdatedAt: number
  readonly rawHash: string

  private constructor(params: {
    agentId: string
    sourceKind: string
    sourcePath: string
    sourceEventId: string
    sessionId?: string
    model: string
    providerName?: string
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheCreationTokens: number
    occurredAt: number
    rawUpdatedAt: number
    rawHash: string
  }) {
    if (!params.agentId) throw new Error('UsageRecord: agentId is required')
    if (!params.sourceEventId) throw new Error('UsageRecord: sourceEventId is required')
    this.agentId = params.agentId
    this.sourceKind = params.sourceKind
    this.sourcePath = params.sourcePath
    this.sourceEventId = params.sourceEventId
    this.sessionId = params.sessionId
    this.model = params.model
    this.providerName = params.providerName
    this.inputTokens = params.inputTokens
    this.outputTokens = params.outputTokens
    this.cacheReadTokens = params.cacheReadTokens
    this.cacheCreationTokens = params.cacheCreationTokens
    this.occurredAt = params.occurredAt
    this.rawUpdatedAt = params.rawUpdatedAt
    this.rawHash = params.rawHash
  }

  static create(params: {
    agentId: string
    sourceKind: string
    sourcePath: string
    sourceEventId: string
    sessionId?: string
    model: string
    providerName?: string
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheCreationTokens: number
    occurredAt: number
    rawUpdatedAt: number
    rawHash: string
  }): UsageRecord {
    return new UsageRecord(params)
  }

  /** Compute SHA-256 of a raw string (mirrors Rust raw_hash helper). */
  static computeHash(raw: string): string {
    return createHash('sha256').update(raw, 'utf8').digest('hex')
  }
}

// ---- Value objects ----

export interface UsageSyncSummary {
  imported: number
  failed: number
  platforms: string[]
}

export interface UsageSummary {
  totalTokens: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  requests: number
  /** 估算消费（USD）；未计价模型按 0 计。 */
  totalCostUsd: number
  lastSyncedAt: number | null
}

export interface UsageTrendPoint {
  date: string
  totalTokens: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  requests: number
  /** 估算消费（USD），仅 metric==='cost' 时有意义；其余维度为 0。 */
  costUsd: number
}

export interface PlatformUsageBreakdown {
  platform: string
  totalTokens: number
  inputTokens: number
  outputTokens: number
  cacheTokens: number
  requests: number
  shareRatio: number
}

export interface UsageSyncStatus {
  supportedPlatforms: string[]
  pendingPlatforms: string[]
  failedPlatforms: string[]
  lastSyncedAt: number | null
  healthStatus: string
}

export interface UsageSyncResultState {
  readerName: string
  status: string
  updatedAt: number
}

/** Cursor for incremental reads — currently unused (all adapters do full scan). */
export interface UsageCursor {
  sourcePath: string
  lastOffset: number
  lastModifiedNs: number
}

/** Batch returned by each agent adapter's readUsageMetrics. */
export interface UsageMetricsBatch {
  records: UsageRecord[]
  nextCursor: UsageCursor
  /**
   * 本轮实际处理（读取并解析）过的文件 + 其 mtime(ms)。增量同步用：同步服务在
   * upsert 成功后据此推进 per-file 游标。未实现增量的 reader 可省略。
   */
  processedFiles?: Array<{ sourcePath: string; mtimeMs: number }>
}
