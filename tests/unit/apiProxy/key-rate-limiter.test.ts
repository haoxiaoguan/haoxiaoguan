import { describe, it, expect } from 'vitest'
import { KeyRateLimiter } from '../../../src/main/contexts/apiProxy/domain/key-rate-limiter'

describe('KeyRateLimiter', () => {
  // ---- 基础：耗尽与 ok:false + retryAfterSec ----
  it('首次 tryAcquire 消耗 1 token，返回 ok:true', () => {
    const now = 0
    const limiter = new KeyRateLimiter({ capacity: 3, refillPerMinute: 3, clock: () => now })
    expect(limiter.tryAcquire('k1')).toEqual({ ok: true })
  })

  it('连续 capacity 次 tryAcquire 均 ok:true，第 capacity+1 次返回 ok:false', () => {
    const now = 0
    const limiter = new KeyRateLimiter({ capacity: 3, refillPerMinute: 60, clock: () => now })
    for (let i = 0; i < 3; i++) {
      expect(limiter.tryAcquire('k1').ok).toBe(true)
    }
    const result = limiter.tryAcquire('k1')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.retryAfterSec).toBeGreaterThan(0)
  })

  it('耗尽后 retryAfterSec 大于 0', () => {
    const now = 0
    const limiter = new KeyRateLimiter({ capacity: 1, refillPerMinute: 1, clock: () => now })
    limiter.tryAcquire('k1') // 消耗唯一 token
    const result = limiter.tryAcquire('k1')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.retryAfterSec).toBeGreaterThanOrEqual(1)
  })

  // ---- clock 推进后 refill 恢复 ----
  it('clock 推进 1 分钟后 refill，可再次获取 token', () => {
    let now = 0
    const limiter = new KeyRateLimiter({ capacity: 2, refillPerMinute: 2, clock: () => now })
    limiter.tryAcquire('k1')
    limiter.tryAcquire('k1')
    // 此时耗尽
    expect(limiter.tryAcquire('k1').ok).toBe(false)
    // 推进 1 分钟
    now += 60_000
    // 应当 refill 2 token（不超过 capacity），可再次获取
    expect(limiter.tryAcquire('k1').ok).toBe(true)
  })

  it('clock 推进半分钟 refill 部分 token（refillPerMinute=2 → 1 token）', () => {
    let now = 0
    const limiter = new KeyRateLimiter({ capacity: 2, refillPerMinute: 2, clock: () => now })
    limiter.tryAcquire('k1')
    limiter.tryAcquire('k1')
    expect(limiter.tryAcquire('k1').ok).toBe(false)
    // 推进 30s → refill 1 token
    now += 30_000
    expect(limiter.tryAcquire('k1').ok).toBe(true)
    // 再拿一个应该仍不足（还没再 refill）
    expect(limiter.tryAcquire('k1').ok).toBe(false)
  })

  // ---- 不同 key 独立桶 ----
  it('不同 keyId 各自独立桶，互不影响', () => {
    const now = 0
    const limiter = new KeyRateLimiter({ capacity: 1, refillPerMinute: 1, clock: () => now })
    limiter.tryAcquire('keyA') // 消耗 keyA 的 token
    // keyB 独立，仍有 token
    expect(limiter.tryAcquire('keyB').ok).toBe(true)
    // keyA 已耗尽
    expect(limiter.tryAcquire('keyA').ok).toBe(false)
  })

  // ---- capacity 边界 ----
  it('refill 不超过 capacity 上限', () => {
    let now = 0
    const limiter = new KeyRateLimiter({ capacity: 2, refillPerMinute: 10, clock: () => now })
    // 初始满桶 → 拿光
    limiter.tryAcquire('k1')
    limiter.tryAcquire('k1')
    // 推进 1 分钟（理论 refill 10，但 cap 为 2）
    now += 60_000
    // 只能拿 2 个
    expect(limiter.tryAcquire('k1').ok).toBe(true)
    expect(limiter.tryAcquire('k1').ok).toBe(true)
    expect(limiter.tryAcquire('k1').ok).toBe(false)
  })

  it('capacity=1 refillPerMinute=60 → retryAfterSec 约为 1', () => {
    const now = 0
    const limiter = new KeyRateLimiter({ capacity: 1, refillPerMinute: 60, clock: () => now })
    limiter.tryAcquire('k1')
    const result = limiter.tryAcquire('k1')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      // 1 token/s → 等待 1s
      expect(result.retryAfterSec).toBe(1)
    }
  })
})
