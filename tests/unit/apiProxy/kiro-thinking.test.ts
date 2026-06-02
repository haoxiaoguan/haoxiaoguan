import { describe, it, expect } from 'vitest'
import {
  buildThinkingPrefix,
  injectThinkingIntoSystem,
  buildAdditionalModelRequestFields,
  parseThinkingTags,
} from '../../../src/main/contexts/apiProxy/infrastructure/adapters/kiro/kiro-thinking'

describe('buildThinkingPrefix', () => {
  it('returns the tag prefix with the budget when enabled', () => {
    expect(buildThinkingPrefix({ type: 'enabled', budgetTokens: 4096 })).toBe(
      '<thinking_mode>enabled</thinking_mode>\n<max_thinking_length>4096</max_thinking_length>',
    )
  })
  it('defaults the budget to 200000 when not given', () => {
    expect(buildThinkingPrefix({ type: 'enabled' })).toBe(
      '<thinking_mode>enabled</thinking_mode>\n<max_thinking_length>200000</max_thinking_length>',
    )
  })
  it('clamps budget into [1024, 200000]', () => {
    expect(buildThinkingPrefix({ type: 'enabled', budgetTokens: 10 })).toContain('<max_thinking_length>1024</max_thinking_length>')
    expect(buildThinkingPrefix({ type: 'enabled', budgetTokens: 999999 })).toContain('<max_thinking_length>200000</max_thinking_length>')
  })
  it('returns empty string when disabled or absent', () => {
    expect(buildThinkingPrefix({ type: 'disabled' })).toBe('')
    expect(buildThinkingPrefix(undefined)).toBe('')
  })
})

describe('injectThinkingIntoSystem', () => {
  it('prepends prefix to existing system with a blank line', () => {
    expect(injectThinkingIntoSystem('You are X.', { type: 'enabled', budgetTokens: 2048 })).toBe(
      '<thinking_mode>enabled</thinking_mode>\n<max_thinking_length>2048</max_thinking_length>\n\nYou are X.',
    )
  })
  it('returns prefix alone when no system', () => {
    expect(injectThinkingIntoSystem(undefined, { type: 'enabled', budgetTokens: 2048 })).toBe(
      '<thinking_mode>enabled</thinking_mode>\n<max_thinking_length>2048</max_thinking_length>',
    )
  })
  it('returns system unchanged when thinking disabled/absent', () => {
    expect(injectThinkingIntoSystem('keep me', undefined)).toBe('keep me')
    expect(injectThinkingIntoSystem(undefined, { type: 'disabled' })).toBeUndefined()
  })
})

describe('buildAdditionalModelRequestFields', () => {
  it('emits thinking with clamped budget_tokens when enabled', () => {
    expect(buildAdditionalModelRequestFields({ type: 'enabled', budgetTokens: 4096 })).toEqual({
      thinking: { type: 'enabled', budget_tokens: 4096 },
    })
    expect(buildAdditionalModelRequestFields({ type: 'enabled' })).toEqual({
      thinking: { type: 'enabled', budget_tokens: 200000 },
    })
    expect(buildAdditionalModelRequestFields({ type: 'enabled', budgetTokens: 1 })).toEqual({
      thinking: { type: 'enabled', budget_tokens: 1024 },
    })
  })
  it('returns undefined when disabled/absent', () => {
    expect(buildAdditionalModelRequestFields({ type: 'disabled' })).toBeUndefined()
    expect(buildAdditionalModelRequestFields(undefined)).toBeUndefined()
  })
})

describe('parseThinkingTags', () => {
  it('extracts the outer <thinking>…</thinking> and returns the remainder', () => {
    expect(parseThinkingTags('<thinking>reasoning here</thinking>final answer')).toEqual({
      thinking: 'reasoning here',
      text: 'final answer',
    })
  })
  it('handles multiline thinking (DOTALL)', () => {
    const r = parseThinkingTags('<thinking>line1\nline2</thinking>\n\nresult')
    expect(r.thinking).toBe('line1\nline2')
    expect(r.text).toBe('result')
  })
  it('returns the text unchanged when no thinking tags', () => {
    expect(parseThinkingTags('just text')).toEqual({ text: 'just text' })
  })
})
