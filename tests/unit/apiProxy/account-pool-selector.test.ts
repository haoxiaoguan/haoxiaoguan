import { describe, it, expect } from 'vitest'
import { AccountPoolSelector } from '../../../src/main/contexts/apiProxy/domain/account-selection/account-pool-selector'

const ALWAYS_OK = { isAvailable: () => true }

function mk(strategy: 'sticky-lru' | 'round-robin', now = { t: 0 }, health = ALWAYS_OK) {
  return new AccountPoolSelector(
    { strategy, perAccountConcurrency: 2, affinityTtlMs: 1000, clock: () => now.t },
    health,
  )
}

function mkWithBucket(capacity: number, refillPerMinute: number, now = { t: 0 }, health = ALWAYS_OK) {
  return new AccountPoolSelector(
    {
      strategy: 'sticky-lru',
      perAccountConcurrency: 10,
      affinityTtlMs: 1000,
      clock: () => now.t,
      tokenBucket: { capacityPerAccount: capacity, refillPerMinute },
    },
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

describe('AccountPoolSelector — per-account 令牌桶', () => {
  const cands = [{ id: 'a' }, { id: 'b' }]

  it('capacity=2：同账号 acquire 两次成功，第三次该账号被跳过（切到 b）', () => {
    const now = { t: 0 }
    const sel = mkWithBucket(2, 60, now)
    const l1 = sel.acquire(cands, ctx())
    expect(l1?.id).toBe('a')
    l1!.release()
    const l2 = sel.acquire(cands, ctx())
    expect(l2?.id).toBe('a')
    l2!.release()
    // a 桶空（tokens=0），第三次应选 b
    const l3 = sel.acquire(cands, ctx())
    expect(l3?.id).toBe('b')
    l3!.release()
  })

  it('clock 推进足够时间后令牌补充，之前被限流的账号重新可选', () => {
    const now = { t: 0 }
    const sel = mkWithBucket(1, 60, now) // capacity=1，1分钟补1
    // 消耗唯一账号 a 的 1 个令牌
    const l1 = sel.acquire([{ id: 'a' }], ctx())
    expect(l1?.id).toBe('a')
    l1!.release()
    // a 桶空 → null
    expect(sel.acquire([{ id: 'a' }], ctx())).toBeNull()
    // 推进 60 秒（= 1 分钟 × refillPerMinute=60 → 补 60 token，capped to capacity=1）
    now.t = 60_000
    const l2 = sel.acquire([{ id: 'a' }], ctx())
    expect(l2?.id).toBe('a')
    l2!.release()
  })

  it('不配 tokenBucket 时 acquire 行为与无令牌桶完全一致（零回归）', () => {
    // 使用 mk() 不配 tokenBucket
    const sel = mk('sticky-lru')
    // 大量 acquire 不应被限流
    const results: Array<string | null> = []
    for (let i = 0; i < 10; i++) {
      const l = sel.acquire([{ id: 'a' }], ctx())
      results.push(l?.id ?? null)
      l?.release()
    }
    // 全部应该成功选到 a（并发=1，release 后立即可再选）
    expect(results.every((r) => r === 'a')).toBe(true)
  })

  it('新账号首次 acquire 初始满桶（不会被立即限流）', () => {
    const now = { t: 0 }
    const sel = mkWithBucket(3, 60, now)
    // 账号 z 是新账号，应初始满桶（3 tokens）
    const acquired: string[] = []
    for (let i = 0; i < 3; i++) {
      const l = sel.acquire([{ id: 'z' }], ctx())
      if (l !== null) { acquired.push(l.id); l.release() }
    }
    expect(acquired).toHaveLength(3)
    // 第 4 次桶空 → null
    expect(sel.acquire([{ id: 'z' }], ctx())).toBeNull()
  })
})
