import { describe, it, expect } from 'vitest'
import { mapModelId, normalizeClaudeVersion } from '../../../src/main/contexts/apiProxy/infrastructure/adapters/kiro/kiro-model-map'

describe('normalizeClaudeVersion', () => {
  it('converts the version dash to a dot (claude-sonnet-4-5 → claude-sonnet-4.5)', () => {
    expect(normalizeClaudeVersion('claude-sonnet-4-5')).toBe('claude-sonnet-4.5')
    expect(normalizeClaudeVersion('claude-opus-4-6')).toBe('claude-opus-4.6')
    expect(normalizeClaudeVersion('claude-haiku-4-5')).toBe('claude-haiku-4.5')
  })
  it('leaves already-dotted versions unchanged', () => {
    expect(normalizeClaudeVersion('claude-sonnet-4.5')).toBe('claude-sonnet-4.5')
  })
  it('does NOT touch date-snapshot suffixes', () => {
    expect(normalizeClaudeVersion('claude-sonnet-4-20250514')).toBe('claude-sonnet-4-20250514')
  })
  it('leaves non-claude strings unchanged', () => {
    expect(normalizeClaudeVersion('gpt-4o')).toBe('gpt-4o')
  })
})

describe('mapModelId', () => {
  it('maps known dashed aliases to dotted', () => {
    expect(mapModelId('claude-sonnet-4-5')).toBe('claude-sonnet-4.5')
    expect(mapModelId('claude-opus-4-5')).toBe('claude-opus-4.5')
  })
  it('passes through CodeWhisperer uppercase-underscore ids verbatim', () => {
    expect(mapModelId('CLAUDE_SONNET_4_20250514_V1_0')).toBe('CLAUDE_SONNET_4_20250514_V1_0')
  })
  it('passes through forward-compatible claude-* prefixes not in the map', () => {
    expect(mapModelId('claude-opus-4.8')).toBe('claude-opus-4.8')
    expect(mapModelId('claude-opus-4-8')).toBe('claude-opus-4.8') // normalized first
  })
  it('falls back to default for empty / unknown models', () => {
    expect(mapModelId('')).toBe('claude-sonnet-4.5')
    expect(mapModelId('   ')).toBe('claude-sonnet-4.5')
    expect(mapModelId('totally-made-up')).toBe('claude-sonnet-4.5')
    expect(mapModelId('gpt-4o')).toBe('claude-sonnet-4.5')
  })
  it('is case-insensitive for alias matching', () => {
    expect(mapModelId('Claude-Sonnet-4-5')).toBe('claude-sonnet-4.5')
  })
})
