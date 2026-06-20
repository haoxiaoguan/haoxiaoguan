/**
 * UsageEventIngestService —— 写路径：双源 ingest + 去重。
 *
 * 两个入口：
 *   - ingestProxyEvent：代理层实时请求，agent 由 AgentDetector 从 user-agent 推断，
 *     cost 按 format/agent 缓存语义计算，直接写入（不去重，第一手数据）。
 *   - ingestSessionBatch：会话日志扫描，agentId 直接取 record.agentId，
 *     dedupId = 'session:{sourceEventId}'，写入前按 dedup_id + 指纹去重。
 *
 * 错误处理：内部 try-catch 记录错误日志（不吞错到无输出），不阻断主流程。
 */
import type { ProxyRequestRecord } from '../../apiProxy/domain/observability/proxy-request-log'
import type { UsageRecord } from '../../usage/domain/usage-record'
import type { MikroOrmUsageEventRepository } from '../infrastructure/mikro-orm-usage-event-repository'
import type { MikroOrmPricingRepository } from '../infrastructure/mikro-orm-pricing-repository'
import { detectAgent } from './agent-detector'
import { buildPricingIndex, calculateForAgent } from '../domain/usage-pricing'
import type { UsageEvent, ModelPricingRow, PricingConfig } from '../domain/usage-event'

export class UsageEventIngestService {
  private pricingIndex: Map<string, ModelPricingRow> | null = null
  private configCache: Map<string, PricingConfig> = new Map()

  constructor(
    private readonly eventRepo: MikroOrmUsageEventRepository,
    private readonly pricingRepo: MikroOrmPricingRepository,
  ) {}

  /** 代理层实时请求 ingest。 */
  async ingestProxyEvent(record: ProxyRequestRecord, userAgent: string): Promise<void> {
    try {
      const agentId = detectAgent(userAgent)
      const index = await this.ensurePricingIndex()
      const config = await this.ensureConfig(agentId)

      // cost 计算：按 agent 缓存语义区分
      const tokenSums = {
        inputTokens: record.inputTokens ?? 0,
        outputTokens: record.outputTokens ?? 0,
        cacheReadTokens: record.cacheReadTokens ?? 0,
        cacheCreationTokens: record.cacheWriteTokens ?? 0,
      }
      const model = record.finalModel ?? record.requestedModel ?? ''
      const cost = calculateForAgent(agentId, model, tokenSums, index, config)

      const now = Math.floor(Date.now() / 1000)
      const event: UsageEvent = {
        dedupId: `proxy:${record.seq}`,
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
      await this.eventRepo.insertProxyEvent(event)
    } catch (err) {
      console.error('[analytics] ingestProxyEvent failed:', err)
    }
  }

  /** 会话日志扫描批量 ingest（内含去重）。 */
  async ingestSessionBatch(records: UsageRecord[]): Promise<void> {
    if (records.length === 0) return
    try {
      const index = await this.ensurePricingIndex()
      const now = Math.floor(Date.now() / 1000)

      const events: UsageEvent[] = []
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
          dedupId: `session:${record.sourceEventId}`,
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
        events.push(evt)
      }

      const inserted = await this.eventRepo.insertSessionEvents(events)
      console.log(`[analytics] ingestSessionBatch: ${inserted}/${events.length} inserted`)
    } catch (err) {
      console.error('[analytics] ingestSessionBatch failed:', err)
    }
  }

  /** 懒加载定价索引（首次调用时从 DB 读取，后续缓存）。 */
  private async ensurePricingIndex(): Promise<Map<string, ModelPricingRow>> {
    if (this.pricingIndex === null) {
      const rows = await this.pricingRepo.listPricing()
      this.pricingIndex = buildPricingIndex(rows)
      console.log(`[analytics] pricing index loaded: ${rows.length} rows`)
    }
    return this.pricingIndex
  }

  /** 懒加载 per-agent 配置（缓存，避免每次请求查 DB）。 */
  private async ensureConfig(agentId: string): Promise<PricingConfig> {
    let config = this.configCache.get(agentId)
    if (config === undefined) {
      config = await this.pricingRepo.getConfig(agentId)
      this.configCache.set(agentId, config)
    }
    return config
  }
}
