/**
 * MikroORM 实体：pricing_config（per-agent 成本倍率与计费模式）。
 *
 * cost_multiplier：成本倍率（默认 1.0），作用于最终总价。
 * pricing_model_source：计费基准模型来源——'request'（用客户端请求的模型名计价）
 *   或 'response'（用上游实际返回的模型名计价，默认）。
 */
import { Entity, PrimaryKey, Property } from '@mikro-orm/core'

@Entity({ tableName: 'pricing_config' })
export class PricingConfigEntity {
  @PrimaryKey({ type: 'text', fieldName: 'agent_id' })
  agentId!: string

  @Property({ type: 'real', fieldName: 'cost_multiplier', default: 1.0 })
  costMultiplier!: number

  @Property({ type: 'text', fieldName: 'pricing_model_source', default: 'response' })
  pricingModelSource!: string
}
