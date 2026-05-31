/**
 * Unit tests for UsageRecord domain invariants.
 */
import { describe, it, expect } from 'vitest'
import { UsageRecord } from '../../../src/main/contexts/usage/domain/usage-record'

const BASE = {
  agentId: 'claude',
  sourceKind: 'session',
  sourcePath: '/home/.claude/projects/foo.jsonl',
  sourceEventId: '/home/.claude/projects/foo.jsonl:0',
  model: 'claude-3-5-sonnet',
  providerName: 'anthropic',
  inputTokens: 100,
  outputTokens: 50,
  cacheReadTokens: 10,
  cacheCreationTokens: 5,
  occurredAt: 1700000000,
  rawUpdatedAt: 1700000001,
  rawHash: 'abc123',
}

describe('UsageRecord', () => {
  it('creates a valid record', () => {
    const r = UsageRecord.create(BASE)
    expect(r.agentId).toBe('claude')
    expect(r.inputTokens).toBe(100)
    expect(r.outputTokens).toBe(50)
    expect(r.cacheReadTokens).toBe(10)
    expect(r.cacheCreationTokens).toBe(5)
    expect(r.occurredAt).toBe(1700000000)
  })

  it('throws when agentId is empty', () => {
    expect(() => UsageRecord.create({ ...BASE, agentId: '' })).toThrow('agentId')
  })

  it('throws when sourceEventId is empty', () => {
    expect(() => UsageRecord.create({ ...BASE, sourceEventId: '' })).toThrow('sourceEventId')
  })

  it('allows optional sessionId and providerName to be undefined', () => {
    const r = UsageRecord.create({ ...BASE, sessionId: undefined, providerName: undefined })
    expect(r.sessionId).toBeUndefined()
    expect(r.providerName).toBeUndefined()
  })

  it('computeHash returns a 64-char hex string', () => {
    const h = UsageRecord.computeHash('hello world')
    expect(h).toHaveLength(64)
    expect(h).toMatch(/^[0-9a-f]+$/)
  })

  it('computeHash is deterministic', () => {
    expect(UsageRecord.computeHash('test')).toBe(UsageRecord.computeHash('test'))
  })

  it('computeHash differs for different inputs', () => {
    expect(UsageRecord.computeHash('a')).not.toBe(UsageRecord.computeHash('b'))
  })
})
