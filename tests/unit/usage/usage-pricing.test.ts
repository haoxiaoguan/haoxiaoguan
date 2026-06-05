import { describe, it, expect } from 'vitest'
import { findPrice, costForModel, totalCostUsd } from '../../../src/main/contexts/usage/domain/usage-pricing'

describe('usage-pricing — 模型匹配与费用计算', () => {
  it('精确匹配 gpt-5.5 单价（USD/百万）', () => {
    // gpt-5.5: input 5 / output 30 /百万
    expect(costForModel('gpt-5.5', { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 })).toBeCloseTo(5, 6)
    expect(costForModel('gpt-5.5', { inputTokens: 0, outputTokens: 1_000_000, cacheReadTokens: 0, cacheCreationTokens: 0 })).toBeCloseTo(30, 6)
  })

  it('点号变体归一匹配（claude-opus-4.8 → claude-opus-4-8、glm-5.1）', () => {
    expect(findPrice('claude-opus-4.8')).not.toBeNull()
    expect(findPrice('claude-opus-4-8')).not.toBeNull()
    expect(findPrice('glm-5.1')).not.toBeNull()
  })

  it('reasoning/effort 后缀剥离兜底（claude-opus-4-6-thinking）', () => {
    expect(findPrice('claude-opus-4-6-thinking')).not.toBeNull()
  })

  it('未计价中转模型 → null / 费用 0（产品决策）', () => {
    expect(findPrice('aimami_relay_cf238e2591')).toBeNull()
    expect(
      costForModel('aimami_relay_cf238e2591', {
        inputTokens: 9_999_999,
        outputTokens: 9_999_999,
        cacheReadTokens: 9_999_999,
        cacheCreationTokens: 9_999_999,
      }),
    ).toBe(0)
  })

  it('totalCostUsd 汇总多模型', () => {
    const sum = totalCostUsd([
      { model: 'gpt-5.5', inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
      { model: 'gpt-5.5', inputTokens: 0, outputTokens: 1_000_000, cacheReadTokens: 0, cacheCreationTokens: 0 },
      { model: 'aimami_relay_x', inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
    ])
    expect(sum).toBeCloseTo(35, 6) // 5 + 30 + 0(未计价)
  })
})
