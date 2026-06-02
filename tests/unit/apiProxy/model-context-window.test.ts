import { describe, it, expect } from 'vitest'
import { getContextTokensForModel } from '../../../src/main/contexts/apiProxy/infrastructure/adapters/kiro/model-context-window'

describe('getContextTokensForModel', () => {
  it('默认 Claude 200k', () => {
    expect(getContextTokensForModel('claude-sonnet-4.5')).toBe(200_000)
    expect(getContextTokensForModel('claude-sonnet-4')).toBe(200_000)
  })
  it('4.6+ 或 major≥5 → 1M（dot 与 dash 两种写法）', () => {
    expect(getContextTokensForModel('claude-opus-4.6')).toBe(1_000_000)
    expect(getContextTokensForModel('claude-opus-4-7')).toBe(1_000_000)
    expect(getContextTokensForModel('claude-sonnet-5.0')).toBe(1_000_000)
  })
  it('未知模型回退 200k', () => {
    expect(getContextTokensForModel('gpt-4o')).toBe(200_000)
    expect(getContextTokensForModel('')).toBe(200_000)
  })
})
