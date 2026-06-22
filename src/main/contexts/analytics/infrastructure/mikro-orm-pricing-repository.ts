/**
 * pricing 仓储：model_pricing 表 CRUD + pricing_config 表读写 + getPricingMap（供 ingest 算 cost）。
 */
import type { EntityManager } from '@mikro-orm/better-sqlite'
import { getEm as defaultGetEm } from '../../../platform/persistence/database'
import { ModelPricingEntity } from './model-pricing.entity'
import { PricingConfigEntity } from './pricing-config.entity'
import type { ModelPricingRow, PricingConfig } from '../domain/usage-event'

export class MikroOrmPricingRepository {
  private readonly getEm: () => EntityManager

  constructor(getEmFn?: () => EntityManager) {
    this.getEm = getEmFn ?? defaultGetEm
  }

  async listPricing(): Promise<ModelPricingRow[]> {
    const em = this.getEm()
    const entities = await em.find(ModelPricingEntity, {}, { orderBy: { modelId: 'ASC' } })
    return entities.map((e) => ({
      modelId: e.modelId,
      displayName: e.displayName,
      inputCostPerMillion: e.inputCostPerMillion,
      outputCostPerMillion: e.outputCostPerMillion,
      cacheReadCostPerMillion: e.cacheReadCostPerMillion,
      cacheCreationCostPerMillion: e.cacheCreationCostPerMillion,
    }))
  }

  async upsertPricing(row: ModelPricingRow): Promise<void> {
    const em = this.getEm()
    const existing = await em.findOne(ModelPricingEntity, { modelId: row.modelId })
    if (existing) {
      existing.displayName = row.displayName
      existing.inputCostPerMillion = row.inputCostPerMillion
      existing.outputCostPerMillion = row.outputCostPerMillion
      existing.cacheReadCostPerMillion = row.cacheReadCostPerMillion
      existing.cacheCreationCostPerMillion = row.cacheCreationCostPerMillion
    } else {
      em.persist(
        em.create(ModelPricingEntity, {
          modelId: row.modelId,
          displayName: row.displayName,
          inputCostPerMillion: row.inputCostPerMillion,
          outputCostPerMillion: row.outputCostPerMillion,
          cacheReadCostPerMillion: row.cacheReadCostPerMillion,
          cacheCreationCostPerMillion: row.cacheCreationCostPerMillion,
        }),
      )
    }
    await em.flush()
  }

  async deletePricing(modelId: string): Promise<void> {
    const em = this.getEm()
    const existing = await em.findOne(ModelPricingEntity, { modelId })
    if (existing) {
      await em.removeAndFlush(existing)
    }
  }

  async getConfig(agentId: string): Promise<PricingConfig> {
    const em = this.getEm()
    const existing = await em.findOne(PricingConfigEntity, { agentId })
    if (existing) {
      return {
        agentId: existing.agentId,
        costMultiplier: existing.costMultiplier,
        pricingModelSource: existing.pricingModelSource as 'request' | 'response',
      }
    }
    return { agentId, costMultiplier: 1.0, pricingModelSource: 'response' }
  }

  async setConfig(agentId: string, multiplier: number, source: 'request' | 'response'): Promise<void> {
    const em = this.getEm()
    const existing = await em.findOne(PricingConfigEntity, { agentId })
    if (existing) {
      existing.costMultiplier = multiplier
      existing.pricingModelSource = source
    } else {
      em.persist(
        em.create(PricingConfigEntity, {
          agentId,
          costMultiplier: multiplier,
          pricingModelSource: source,
        }),
      )
    }
    await em.flush()
  }

  /** 返回 modelId → 定价行的 Map（供 ingest 时批量算 cost，避免逐条查 DB）。 */
  async getPricingMap(): Promise<Map<string, ModelPricingRow>> {
    const rows = await this.listPricing()
    const m = new Map<string, ModelPricingRow>()
    for (const r of rows) m.set(r.modelId, r)
    return m
  }
}
