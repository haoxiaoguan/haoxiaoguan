import { describe, it, expect } from 'vitest'
import {
  buildPricingIndex,
  calculateForAgent,
  findPrice,
  type TokenSums,
} from '../../../../src/main/contexts/analytics/domain/usage-pricing'
import type { ModelPricingRow, PricingConfig } from '../../../../src/main/contexts/analytics/domain/usage-event'

const PRICING_ROWS: ModelPricingRow[] = [
  {
    modelId: 'claude-sonnet-4-20250514',
    displayName: 'claude-sonnet-4-20250514',
    inputCostPerMillion: 3.0,
    outputCostPerMillion: 15.0,
    cacheReadCostPerMillion: 0.3,
    cacheCreationCostPerMillion: 3.75,
  },
  {
    modelId: 'gpt-5-codex',
    displayName: 'gpt-5-codex',
    inputCostPerMillion: 1.25,
    outputCostPerMillion: 10.0,
    cacheReadCostPerMillion: 0.125,
    cacheCreationCostPerMillion: 0.0,
  },
]

const INDEX = buildPricingIndex(PRICING_ROWS)

const SUMS: TokenSums = {
  inputTokens: 1000,
  outputTokens: 500,
  cacheReadTokens: 200,
  cacheCreationTokens: 100,
}

describe('usage-pricing 定价计算', () => {
  it('claude 模型不扣 cacheRead（fresh input = input_tokens）', () => {
    const cost = calculateForAgent('claude', 'claude-sonnet-4-20250514', SUMS, INDEX)
    // freshInput = 1000（不扣 cacheRead）
    expect(cost.inputCostUsd).toBeCloseTo((1000 * 3.0) / 1_000_000, 10)
    expect(cost.outputCostUsd).toBeCloseTo((500 * 15.0) / 1_000_000, 10)
    expect(cost.cacheReadCostUsd).toBeCloseTo((200 * 0.3) / 1_000_000, 10)
    expect(cost.cacheCreationCostUsd).toBeCloseTo((100 * 3.75) / 1_000_000, 10)
    expect(cost.totalCostUsd).toBeCloseTo(
      cost.inputCostUsd + cost.outputCostUsd + cost.cacheReadCostUsd + cost.cacheCreationCostUsd,
      10,
    )
  })

  it('codex 模型扣 cacheRead（freshInput = input - cacheRead）', () => {
    const cost = calculateForAgent('codex', 'gpt-5-codex', SUMS, INDEX)
    // freshInput = 1000 - 200 = 800
    expect(cost.inputCostUsd).toBeCloseTo((800 * 1.25) / 1_000_000, 10)
    expect(cost.outputCostUsd).toBeCloseTo((500 * 10.0) / 1_000_000, 10)
    expect(cost.cacheReadCostUsd).toBeCloseTo((200 * 0.125) / 1_000_000, 10)
    expect(cost.cacheCreationCostUsd).toBeCloseTo(0, 10)
  })

  it('gemini-cli 模型也扣 cacheRead', () => {
    const cost = calculateForAgent('gemini-cli', 'gpt-5-codex', SUMS, INDEX)
    // 与 codex 同口径
    expect(cost.inputCostUsd).toBeCloseTo((800 * 1.25) / 1_000_000, 10)
  })

  it('cacheRead > input 时 freshInput 不为负', () => {
    const extremeSums: TokenSums = {
      inputTokens: 100,
      outputTokens: 0,
      cacheReadTokens: 500,
      cacheCreationTokens: 0,
    }
    const cost = calculateForAgent('codex', 'gpt-5-codex', extremeSums, INDEX)
    // freshInput = max(100 - 500, 0) = 0
    expect(cost.inputCostUsd).toBe(0)
  })

  it('未计价模型 cost 全为 0', () => {
    const cost = calculateForAgent('claude', 'unknown-model-xyz', SUMS, INDEX)
    expect(cost.inputCostUsd).toBe(0)
    expect(cost.outputCostUsd).toBe(0)
    expect(cost.cacheReadCostUsd).toBe(0)
    expect(cost.cacheCreationCostUsd).toBe(0)
    expect(cost.totalCostUsd).toBe(0)
  })

  it('cost_multiplier 作用于总价', () => {
    const config: PricingConfig = {
      agentId: 'claude',
      costMultiplier: 2.0,
      pricingModelSource: 'response',
    }
    const cost = calculateForAgent('claude', 'claude-sonnet-4-20250514', SUMS, INDEX, config)
    const baseCost = calculateForAgent('claude', 'claude-sonnet-4-20250514', SUMS, INDEX)
    expect(cost.totalCostUsd).toBeCloseTo(baseCost.totalCostUsd * 2.0, 10)
  })

  it('findPrice 支持点号转短横归一', () => {
    // gpt-5.5 → gpt-5-5 不会命中 gpt-5-codex，返回 null
    expect(findPrice('gpt-5.5', INDEX)).toBeNull()
    // gpt-5-codex 精确命中
    expect(findPrice('gpt-5-codex', INDEX)).not.toBeNull()
  })
})
