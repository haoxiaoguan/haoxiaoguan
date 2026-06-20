/**
 * 定价表 seed：从硬编码的 model-pricing-data.ts 导入 147 条到 DB。
 * 幂等——model_id 已存在则跳过（INSERT OR IGNORE 语义）。
 */
import type { EntityManager } from '@mikro-orm/better-sqlite'
import { MODEL_PRICING } from '../../usage/domain/model-pricing-data'
import { ModelPricingEntity } from './model-pricing.entity'

/**
 * 把 MODEL_PRICING（147 条）seed 到 model_pricing 表。
 * 已存在的 model_id 跳过，不覆盖用户自定义价格。
 */
export async function seedModelPricing(em: EntityManager): Promise<number> {
  let inserted = 0
  for (const row of MODEL_PRICING) {
    // 先查是否已存在，存在则跳过（幂等，保护用户改过的价格）
    const existing = await em.findOne(ModelPricingEntity, { modelId: row.id })
    if (existing) continue
    em.persist(
      em.create(ModelPricingEntity, {
        modelId: row.id,
        displayName: row.id,
        inputCostPerMillion: row.inP,
        outputCostPerMillion: row.outP,
        cacheReadCostPerMillion: row.crP,
        cacheCreationCostPerMillion: row.ccP,
      }),
    )
    inserted++
  }
  if (inserted > 0) {
    await em.flush()
  }
  return inserted
}
