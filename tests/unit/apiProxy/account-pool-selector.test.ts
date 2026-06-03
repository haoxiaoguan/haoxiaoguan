import { describe, it, expect } from 'vitest'
import { AccountPoolSelector } from '../../../src/main/contexts/apiProxy/domain/account-selection/account-pool-selector'

const ALWAYS_OK = { isAvailable: () => true }

function mk(strategy: 'sticky-lru' | 'round-robin', now = { t: 0 }, health = ALWAYS_OK) {
  return new AccountPoolSelector(
    { strategy, perAccountConcurrency: 2, affinityTtlMs: 1000, clock: () => now.t },
    health,
  )
}
const ctx = (over: Partial<{ hint: string; triedIds: Set<string>; model: string }> = {}) => ({
  triedIds: new Set<string>(), model: 'claude-sonnet-4.5', ...over,
})

describe('AccountPoolSelector', () => {
  it('空候选 → null', () => {
    expect(mk('sticky-lru').acquire([], ctx())).toBeNull()
  })
  it('sticky-lru：LRU（lastUsedAt 最早）优先', () => {
    const sel = mk('sticky-lru')
    const lease = sel.acquire([{ id: 'a', lastUsedAt: 100 }, { id: 'b', lastUsedAt: 50 }], ctx())
    expect(lease?.id).toBe('b')
  })
  it('排除 triedIds', () => {
    const sel = mk('sticky-lru')
    const lease = sel.acquire([{ id: 'a', lastUsedAt: 1 }], ctx({ triedIds: new Set(['a']) }))
    expect(lease).toBeNull()
  })
  it('粘性命中复用同账号', () => {
    const sel = mk('sticky-lru')
    sel.remember('h1', 'b')
    const lease = sel.acquire([{ id: 'a', lastUsedAt: 1 }, { id: 'b', lastUsedAt: 9 }], ctx({ hint: 'h1' }))
    expect(lease?.id).toBe('b') // 命中 b 而非 LRU 的 a
  })
  it('并发闸：达到上限的账号被跳过', () => {
    const sel = mk('sticky-lru')
    const l1 = sel.acquire([{ id: 'a' }], ctx())! // inflight a = 1
    const l2 = sel.acquire([{ id: 'a' }], ctx())! // inflight a = 2 (上限)
    const l3 = sel.acquire([{ id: 'a' }], ctx())  // 满载 → null
    expect(l3).toBeNull()
    l1.release()
    expect(sel.acquire([{ id: 'a' }], ctx())?.id).toBe('a') // 释放后可再选
    l2.release()
  })
  it('round-robin 游标推进', () => {
    const sel = mk('round-robin')
    const cands = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    const ids = [0, 1, 2].map(() => { const l = sel.acquire(cands, ctx())!; const id = l.id; l.release(); return id })
    expect(new Set(ids).size).toBeGreaterThan(1) // 不是每次都同一个
  })
  it('health 不可用的账号被过滤', () => {
    const sel = mk('sticky-lru', { t: 0 }, { isAvailable: (id: string) => id !== 'a' })
    const lease = sel.acquire([{ id: 'a', lastUsedAt: 1 }, { id: 'b', lastUsedAt: 9 }], ctx())
    expect(lease?.id).toBe('b')
  })
  it('粘性 TTL 过期后不复用', () => {
    const now = { t: 0 }; const sel = mk('sticky-lru', now)
    sel.remember('h1', 'b')
    now.t = 2000 // > affinityTtlMs 1000
    const lease = sel.acquire([{ id: 'a', lastUsedAt: 1 }, { id: 'b', lastUsedAt: 9 }], ctx({ hint: 'h1' }))
    expect(lease?.id).toBe('a') // 过期 → 落 LRU
  })
})
