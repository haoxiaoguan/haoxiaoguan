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
})
