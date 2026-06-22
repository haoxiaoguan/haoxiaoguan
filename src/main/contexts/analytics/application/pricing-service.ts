/**
 * PricingService —— 定价表 CRUD + 倍率配置。透传仓储。
 */
import type { MikroOrmPricingRepository } from '../infrastructure/mikro-orm-pricing-repository'
import type { ModelPricingRow, PricingConfig } from '../domain/usage-event'

export class PricingService {
  constructor(private readonly pricingRepo: MikroOrmPricingRepository) {}

  async listPricing(): Promise<ModelPricingRow[]> {
    return this.pricingRepo.listPricing()
  }

  async upsertPricing(row: ModelPricingRow): Promise<void> {
    await this.pricingRepo.upsertPricing(row)
  }

  async deletePricing(modelId: string): Promise<void> {
    await this.pricingRepo.deletePricing(modelId)
  }

  async getConfig(agentId: string): Promise<PricingConfig> {
    return this.pricingRepo.getConfig(agentId)
  }

  async setConfig(agentId: string, multiplier: number, source: 'request' | 'response'): Promise<void> {
    await this.pricingRepo.setConfig(agentId, multiplier, source)
  }
}
