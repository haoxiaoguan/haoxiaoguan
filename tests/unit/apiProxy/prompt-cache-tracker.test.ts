import { describe, it, expect } from 'vitest'
import { PromptCacheTracker, type CacheBreakpointInput } from '../../../src/main/contexts/apiProxy/domain/usage/prompt-cache-tracker'

const T0 = 1_000_000
function blocks(): CacheBreakpointInput[] {
  return [{ value: 'system-prompt-A', tokens: 2000, ttl: 5 * 60 * 1000, isMessageEnd: true }]
}

describe('PromptCacheTracker', () => {
  it('首次请求：全部 creation，read=0', () => {
    const t = new PromptCacheTracker()
    const p = t.buildProfile(blocks(), 2000, 'claude-sonnet-4.5')
    const u = t.compute('acc1', p, T0)
    expect(u.cacheReadInputTokens).toBe(0)
    expect(u.cacheCreationInputTokens).toBeGreaterThan(0)
  })

  it('update 后二次同前缀：read 命中', () => {
    const t = new PromptCacheTracker()
    const p = t.buildProfile(blocks(), 2000, 'claude-sonnet-4.5')
    t.compute('acc1', p, T0)
    t.update('acc1', p, T0)
    const u2 = t.compute('acc1', p, T0 + 1000)
    expect(u2.cacheReadInputTokens).toBeGreaterThan(0)
  })

  it('TTL 过期后不命中', () => {
    const t = new PromptCacheTracker()
    const p = t.buildProfile(blocks(), 2000, 'claude-sonnet-4.5')
    t.update('acc1', p, T0)
    const u = t.compute('acc1', p, T0 + 6 * 60 * 1000)
    expect(u.cacheReadInputTokens).toBe(0)
  })

  it('低于阈值（<1024）不缓存', () => {
    const t = new PromptCacheTracker()
    const small: CacheBreakpointInput[] = [{ value: 'x', tokens: 500, ttl: 5 * 60 * 1000, isMessageEnd: true }]
    const p = t.buildProfile(small, 500, 'claude-sonnet-4.5')
    const u = t.compute('acc1', p, T0)
    expect(u.cacheCreationInputTokens).toBe(0)
  })

  it('账号隔离：acc2 不命中 acc1 的缓存', () => {
    const t = new PromptCacheTracker()
    const p = t.buildProfile(blocks(), 2000, 'claude-sonnet-4.5')
    t.update('acc1', p, T0)
    const u = t.compute('acc2', p, T0 + 1000)
    expect(u.cacheReadInputTokens).toBe(0)
  })
})
