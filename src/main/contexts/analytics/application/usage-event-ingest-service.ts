/**
 * UsageEventIngestService —— 写路径：双源 ingest + 去重。
 *
 * 关键设计：better-sqlite3 的 conn.execute 是同步阻塞主线程的，
 * 所以不能每条请求同步写 DB。采用缓冲 + 定时批量 flush 模式
 * （参照 RoutingObservabilityService 的 buffer+flush 架构）：
 *   - ingestProxyEvent：投影成 UsageEvent 入内存缓冲，不写 DB
 *   - ingestSessionBatch：投影成 UsageEvent 入内存缓冲，不写 DB
 *   - flush()：定时（~15s）批量写入，单事务多条 INSERT
 *
 * session 源去重改为批量 INSERT OR IGNORE（dedup_id 唯一索引保证），
 * 不再逐条 SELECT 查重——全量扫描几千条记录时逐条查询会卡死主线程。
 */
import { randomUUID } from 'node:crypto'
import type { ProxyRequestRecord } from '../../apiProxy/domain/observability/proxy-request-log'
import type { UsageRecord } from '../../usage/domain/usage-record'
import type { MikroOrmUsageEventRepository } from '../infrastructure/mikro-orm-usage-event-repository'
import type { MikroOrmPricingRepository } from '../infrastructure/mikro-orm-pricing-repository'
import { detectAgent } from './agent-detector'
import { buildPricingIndex, calculateForAgent } from '../domain/usage-pricing'
import type { UsageEvent, ModelPricingRow, PricingConfig } from '../domain/usage-event'

const BUFFER_CAP = 5000

export class UsageEventIngestService {
  private pricingIndex: Map<string, ModelPricingRow> | null = null
  private configCache: Map<string, PricingConfig> = new Map()
  private buffer: UsageEvent[] = []
  private flushing = false

  constructor(
    private readonly eventRepo: MikroOrmUsageEventRepository,
    private readonly pricingRepo: MikroOrmPricingRepository,
  ) {}

  /** 代理层实时请求 ingest：投影成 UsageEvent 入缓冲，不写 DB。 */
  ingestProxyEvent(record: ProxyRequestRecord, userAgent: string): void {
    try {
      const agentId = detectAgent(userAgent)
      const tokenSums = {
        inputTokens: record.inputTokens ?? 0,
        outputTokens: record.outputTokens ?? 0,
        cacheReadTokens: record.cacheReadTokens ?? 0,
        cacheCreationTokens: record.cacheWriteTokens ?? 0,
      }
      const model = record.finalModel ?? record.requestedModel ?? ''
      // pricingIndex 未加载时 cost 全 0，flush 时重新计算
      const index = this.pricingIndex ?? new Map()
      const config = this.configCache.get(agentId) ?? { agentId, costMultiplier: 1.0, pricingModelSource: 'response' as const }
      const cost = this.pricingIndex !== null
        ? calculateForAgent(agentId, model, tokenSums, index, config)
        : { inputCostUsd: 0, outputCostUsd: 0, cacheReadCostUsd: 0, cacheCreationCostUsd: 0, totalCostUsd: 0 }

      const now = Math.floor(Date.now() / 1000)
      const event: UsageEvent = {
        requestId: randomUUID(),
        source: 'proxy',
        agentId,
        inputTokens: tokenSums.inputTokens,
        outputTokens: tokenSums.outputTokens,
        cacheReadTokens: tokenSums.cacheReadTokens,
        cacheCreationTokens: tokenSums.cacheCreationTokens,
        inputCostUsd: cost.inputCostUsd,
        outputCostUsd: cost.outputCostUsd,
        cacheReadCostUsd: cost.cacheReadCostUsd,
        cacheCreationCostUsd: cost.cacheCreationCostUsd,
        totalCostUsd: cost.totalCostUsd,
        occurredAt: Math.floor(record.tsMs / 1000),
        createdAt: now,
      }
      if (model) event.model = model
      if (record.requestedModel) event.requestedModel = record.requestedModel
      if (record.status != null) event.status = record.status
      if (record.durationMs != null) event.durationMs = record.durationMs
      if (!record.ok) event.errorKind = 'error'
      if (record.accountId) event.accountId = record.accountId
      if (record.clientKeyId) event.clientKeyId = record.clientKeyId
      if (record.comboName) event.comboName = record.comboName
      this.pushToBuffer(event)
    } catch (err) {
      console.error('[analytics] ingestProxyEvent failed:', err)
    }
  }

  /** 会话日志扫描批量 ingest：投影成 UsageEvent 入缓冲，不写 DB。 */
  async ingestSessionBatch(records: UsageRecord[]): Promise<void> {
    if (records.length === 0) return
    try {
      const index = await this.ensurePricingIndex()
      const now = Math.floor(Date.now() / 1000)

      for (const record of records) {
        const config = await this.ensureConfig(record.agentId)
        const tokenSums = {
          inputTokens: record.inputTokens,
          outputTokens: record.outputTokens,
          cacheReadTokens: record.cacheReadTokens,
          cacheCreationTokens: record.cacheCreationTokens,
        }
        const model = record.model
        const cost = calculateForAgent(record.agentId, model, tokenSums, index, config)

        const evt: UsageEvent = {
          requestId: `session:${record.sourceEventId}`,
          source: 'session',
          agentId: record.agentId,
          inputTokens: tokenSums.inputTokens,
          outputTokens: tokenSums.outputTokens,
          cacheReadTokens: tokenSums.cacheReadTokens,
          cacheCreationTokens: tokenSums.cacheCreationTokens,
          inputCostUsd: cost.inputCostUsd,
          outputCostUsd: cost.outputCostUsd,
          cacheReadCostUsd: cost.cacheReadCostUsd,
          cacheCreationCostUsd: cost.cacheCreationCostUsd,
          totalCostUsd: cost.totalCostUsd,
          occurredAt: record.occurredAt,
          createdAt: now,
        }
        if (model) evt.model = model
        if (record.sessionId) evt.sessionId = record.sessionId
        this.pushToBuffer(evt)
      }
    } catch (err) {
      console.error('[analytics] ingestSessionBatch failed:', err)
    }
  }

  /** 定时 flush：批量写入缓冲，单事务。失败丢该批（不重入队，避免毒化）。 */
  async flush(): Promise<void> {
    if (this.flushing || this.buffer.length === 0) return
    this.flushing = true
    const batch = this.buffer
    this.buffer = []
    try {
      await this.ensurePricingIndex()
      // flush 时重新计算 cost（ingestProxyEvent 时 pricingIndex 可能未加载）
      if (this.pricingIndex !== null) {
        for (const evt of batch) {
          if (evt.totalCostUsd === 0 && evt.inputTokens + evt.outputTokens > 0) {
            const config = await this.ensureConfig(evt.agentId)
            const cost = calculateForAgent(evt.agentId, evt.model ?? '', {
              inputTokens: evt.inputTokens,
              outputTokens: evt.outputTokens,
              cacheReadTokens: evt.cacheReadTokens,
              cacheCreationTokens: evt.cacheCreationTokens,
            }, this.pricingIndex, config)
            evt.inputCostUsd = cost.inputCostUsd
            evt.outputCostUsd = cost.outputCostUsd
            evt.cacheReadCostUsd = cost.cacheReadCostUsd
            evt.cacheCreationCostUsd = cost.cacheCreationCostUsd
            evt.totalCostUsd = cost.totalCostUsd
          }
        }
      }
      const inserted = await this.eventRepo.batchInsertEvents(batch)
      const proxyCount = batch.filter((e) => e.source === 'proxy').length
      const sessionCount = batch.length - proxyCount
      if (inserted > 0) {
        console.log(`[analytics] flush: ${inserted}/${batch.length} inserted (proxy:${proxyCount} session:${sessionCount})`)
      }
    } catch (err) {
      console.error('[analytics] flush failed, dropping', batch.length, 'events:', err)
    } finally {
      this.flushing = false
    }
  }

  /** 当前缓冲待写入条数（诊断用）。 */
  pendingCount(): number {
    return this.buffer.length
  }

  private pushToBuffer(event: UsageEvent): void {
    this.buffer.push(event)
    if (this.buffer.length > BUFFER_CAP) {
      this.buffer.splice(0, this.buffer.length - BUFFER_CAP)
    }
  }

  private async ensurePricingIndex(): Promise<Map<string, ModelPricingRow>> {
    if (this.pricingIndex === null) {
      const rows = await this.pricingRepo.listPricing()
      this.pricingIndex = buildPricingIndex(rows)
      console.log(`[analytics] pricing index loaded: ${rows.length} rows`)
    }
    return this.pricingIndex
  }

  private async ensureConfig(agentId: string): Promise<PricingConfig> {
    let config = this.configCache.get(agentId)
    if (config === undefined) {
      config = await this.pricingRepo.getConfig(agentId)
      this.configCache.set(agentId, config)
    }
    return config
  }
}
