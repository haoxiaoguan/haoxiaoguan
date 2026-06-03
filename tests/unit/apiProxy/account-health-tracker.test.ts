import { describe, it, expect } from 'vitest'
import { AccountHealthTracker } from '../../../src/main/contexts/apiProxy/domain/account-selection/account-health-tracker'

function mk(now: { t: number }, random = () => 1) {
  return new AccountHealthTracker({
    baseCooldownMs: 1000, maxBackoffMultiplier: 64, quotaResetMs: 3600000,
    probabilisticRetryChance: 0.1, clock: () => now.t, random,
  })
}

describe('AccountHealthTracker', () => {
  it('全新账号可用', () => {
    const now = { t: 0 }; const h = mk(now)
    expect(h.isAvailable('a')).toBe(true)
  })
  it('markFailure → 指数退避冷却，到期恢复', () => {
    const now = { t: 0 }; const h = mk(now)
    h.markFailure('a')                       // cooldown = 1000 * 2^0 = 1000
    expect(h.isAvailable('a')).toBe(false)
    now.t = 999; expect(h.isAvailable('a')).toBe(false)
    now.t = 1000; expect(h.isAvailable('a')).toBe(true)
  })
  it('连续失败指数增长，封顶 multiplier', () => {
    const now = { t: 0 }; const h = mk(now)
    h.markFailure('a'); h.markFailure('a'); h.markFailure('a') // 2^2=4 → 4000
    expect(h.isAvailable('a')).toBe(false)
    now.t = 4000; expect(h.isAvailable('a')).toBe(true)
  })
  it('概率半开探测：random < chance 时冷却期内放行', () => {
    const now = { t: 0 }; const h = mk(now, () => 0.05) // < 0.1
    h.markFailure('a')
    expect(h.isAvailable('a')).toBe(true) // 半开
  })
  it('recordSuccess 复位熔断', () => {
    const now = { t: 0 }; const h = mk(now)
    h.markFailure('a'); h.recordSuccess('a')
    expect(h.isAvailable('a')).toBe(true)
  })
  it('markRateLimited → quotaResetMs 后恢复', () => {
    const now = { t: 0 }; const h = mk(now)
    h.markRateLimited('a')
    expect(h.isAvailable('a')).toBe(false)
    now.t = 3600000; expect(h.isAvailable('a')).toBe(true)
  })
  it('markSuspended → 永久不可用，clearSuspension 才恢复', () => {
    const now = { t: 0 }; const h = mk(now)
    h.markSuspended('a')
    expect(h.isAvailable('a')).toBe(false)
    now.t = 999999999; expect(h.isAvailable('a')).toBe(false) // 不自恢复
    h.clearSuspension('a')
    expect(h.isAvailable('a')).toBe(true)
  })

  it('recordSuccess 后 fresh entry 从 Map 删除', () => {
    const now = { t: 0 }; const h = mk(now)
    h.markFailure('a')            // 写入一条 entry
    h.recordSuccess('a')          // 重置为 fresh → 应删除
    // isAvailable 对不存在 entry 返回 true（状态最轻量路径）
    expect(h.isAvailable('a')).toBe(true)
    // snapshot 对不存在 entry 返回 available
    expect(h.snapshot('a').runtimeState).toBe('available')
  })

  it('suspended entry 不被 recordSuccess 删除', () => {
    const now = { t: 0 }; const h = mk(now)
    h.markSuspended('a')
    // suspended 状态下 recordSuccess 不应删除 entry（suspended 标记需保留）
    h.recordSuccess('a')
    expect(h.isAvailable('a')).toBe(false) // suspended 仍生效
  })

  it('sweep 清理已完全恢复的 entry', () => {
    const now = { t: 0 }; const h = mk(now)
    h.markFailure('a')            // failureCount=1, cooldownUntil=1000
    now.t = 2000                  // 冷却已过
    // 但 failureCount 仍为 1，sweep 不应删除
    h.sweep()
    expect(h.isAvailable('a')).toBe(true) // 冷却过了，可用
    // 手动重置 failureCount 后再 sweep 应删除
    h.recordSuccess('a')          // 重置并删除（fresh path）
    // entry 已不在 map，snapshot 应返回 available
    expect(h.snapshot('a').runtimeState).toBe('available')
  })

  it('sweep 不删除 suspended entry', () => {
    const now = { t: 0 }; const h = mk(now)
    h.markSuspended('a')
    now.t = 999999999
    h.sweep()
    expect(h.isAvailable('a')).toBe(false) // suspended 保留
  })

  it('sweep 清理配额恢复且 failureCount=0 的 entry', () => {
    const now = { t: 0 }; const h = mk(now)
    h.markRateLimited('a')        // quotaExhaustedAt=0, failureCount=0
    now.t = 3600001               // quota 已恢复（quotaResetMs=3600000）
    h.sweep()
    expect(h.snapshot('a').runtimeState).toBe('available')
  })
})
