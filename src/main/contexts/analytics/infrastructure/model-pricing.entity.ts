/**
 * MikroORM 实体：model_pricing（模型定价表）。
 *
 * 从硬编码的 model-pricing-data.ts 迁移到 DB，支持 CRUD。
 * 单价单位：USD / 每百万 token。
 */
import { Entity, PrimaryKey, Property } from '@mikro-orm/core'

@Entity({ tableName: 'model_pricing' })
export class ModelPricingEntity {
  @PrimaryKey({ type: 'text', fieldName: 'model_id' })
  modelId!: string

  @Property({ type: 'text', fieldName: 'display_name' })
  displayName!: string

  @Property({ type: 'real', fieldName: 'input_cost_per_million' })
  inputCostPerMillion!: number

  @Property({ type: 'real', fieldName: 'output_cost_per_million' })
  outputCostPerMillion!: number

  @Property({ type: 'real', fieldName: 'cache_read_cost_per_million' })
  cacheReadCostPerMillion!: number

  @Property({ type: 'real', fieldName: 'cache_creation_cost_per_million' })
  cacheCreationCostPerMillion!: number
}
