import { describe, it, expect } from 'vitest'
import { mapModelId, normalizeClaudeVersion, resolveCodeWhispererModelId, codeWhispererToOutward } from '../../../src/main/contexts/apiProxy/infrastructure/adapters/kiro/kiro-model-map'

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

// --- P1-6 步骤 2：resolveCodeWhispererModelId ---

describe('resolveCodeWhispererModelId', () => {
  const CW_SONNET_45 = 'CLAUDE_SONNET_4_5_20250514_V1_0'
  const CW_SONNET_4 = 'CLAUDE_SONNET_4_20250514_V1_0'
  const CW_HAIKU_45 = 'CLAUDE_HAIKU_4_5_20250514_V1_0'
  const CW_OPUS_45 = 'CLAUDE_OPUS_4_5_20250514_V1_0'

  const MODELS = [
    { modelId: CW_SONNET_45 },
    { modelId: CW_SONNET_4 },
    { modelId: CW_HAIKU_45 },
    { modelId: CW_OPUS_45 },
  ]

  it('claude-sonnet-4.5 匹配 CLAUDE_SONNET_4_5_*', () => {
    expect(resolveCodeWhispererModelId('claude-sonnet-4.5', MODELS)).toBe(CW_SONNET_45)
  })

  it('claude-sonnet-4-5（短横版本）也能匹配 CLAUDE_SONNET_4_5_*', () => {
    expect(resolveCodeWhispererModelId('claude-sonnet-4-5', MODELS)).toBe(CW_SONNET_45)
  })

  it('claude-sonnet-4 匹配 CLAUDE_SONNET_4_20250514_V1_0', () => {
    expect(resolveCodeWhispererModelId('claude-sonnet-4', MODELS)).toBe(CW_SONNET_4)
  })

  it('claude-sonnet-4-20250514 匹配 CLAUDE_SONNET_4_20250514_V1_0', () => {
    expect(resolveCodeWhispererModelId('claude-sonnet-4-20250514', MODELS)).toBe(CW_SONNET_4)
  })

  it('claude-haiku-4.5 匹配 CLAUDE_HAIKU_4_5_*', () => {
    expect(resolveCodeWhispererModelId('claude-haiku-4.5', MODELS)).toBe(CW_HAIKU_45)
  })

  it('claude-opus-4.5 匹配 CLAUDE_OPUS_4_5_*', () => {
    expect(resolveCodeWhispererModelId('claude-opus-4.5', MODELS)).toBe(CW_OPUS_45)
  })

  it('family 不匹配时返回 undefined（sonnet 查询不命中 haiku 候选）', () => {
    const haikuOnly = [{ modelId: CW_HAIKU_45 }]
    expect(resolveCodeWhispererModelId('claude-sonnet-4.5', haikuOnly)).toBeUndefined()
  })

  it('空模型列表返回 undefined', () => {
    expect(resolveCodeWhispererModelId('claude-sonnet-4.5', [])).toBeUndefined()
  })

  it('列表中无 CodeWhisperer 大写 ID 返回 undefined', () => {
    expect(resolveCodeWhispererModelId('claude-sonnet-4.5', [{ modelId: 'claude-sonnet-4.5' }])).toBeUndefined()
  })

  it('空 outwardId 返回 undefined', () => {
    expect(resolveCodeWhispererModelId('', MODELS)).toBeUndefined()
  })

  it('大写 outwardId（CodeWhisperer 原生 ID）仍能匹配', () => {
    expect(resolveCodeWhispererModelId('CLAUDE_SONNET_4_5_20250514_V1_0', MODELS)).toBe(CW_SONNET_45)
  })
})

describe('codeWhispererToOutward', () => {
  it('CLAUDE_SONNET_4_5_20250514_V1_0 → claude-sonnet-4-5', () => {
    expect(codeWhispererToOutward('CLAUDE_SONNET_4_5_20250514_V1_0')).toBe('claude-sonnet-4-5')
  })

  it('CLAUDE_SONNET_4_20250514_V1_0 → claude-sonnet-4', () => {
    expect(codeWhispererToOutward('CLAUDE_SONNET_4_20250514_V1_0')).toBe('claude-sonnet-4')
  })

  it('CLAUDE_HAIKU_4_5_20250514_V1_0 → claude-haiku-4-5', () => {
    expect(codeWhispererToOutward('CLAUDE_HAIKU_4_5_20250514_V1_0')).toBe('claude-haiku-4-5')
  })

  it('非 CodeWhisperer ID 原样返回', () => {
    expect(codeWhispererToOutward('claude-sonnet-4.5')).toBe('claude-sonnet-4.5')
  })
})
