import { describe, it, expect } from 'vitest'
import { detectAgent } from '../../../../src/main/contexts/analytics/application/agent-detector'

describe('AgentDetector user-agent 识别', () => {
  it('claude-cli 标识 → claude', () => {
    expect(detectAgent('claude-cli/1.0 node/20')).toBe('claude')
  })

  it('codex 标识 → codex', () => {
    expect(detectAgent('codex/0.1.0')).toBe('codex')
  })

  it('gemini 标识 → gemini-cli', () => {
    expect(detectAgent('gemini-cli/0.1.0')).toBe('gemini-cli')
  })

  it('KiroIDE 标识 → kiro', () => {
    expect(detectAgent('KiroIDE-1.0.0-machine123')).toBe('kiro')
  })

  it('qoder 标识 → qoder', () => {
    expect(detectAgent('qoder/1.2.3')).toBe('qoder')
  })

  it('空串 → unknown', () => {
    expect(detectAgent('')).toBe('unknown')
  })

  it('无匹配 → unknown', () => {
    expect(detectAgent('curl/8.0')).toBe('unknown')
  })

  it('大小写不敏感', () => {
    expect(detectAgent('CLAUDE-CLI/1.0')).toBe('claude')
    expect(detectAgent('CODEX/0.1')).toBe('codex')
    expect(detectAgent('KIROIDE-1.0')).toBe('kiro')
  })
})
