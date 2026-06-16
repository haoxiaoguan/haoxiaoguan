import { describe, it, expect } from 'vitest'
import { AccountHealthTracker } from '../../../src/main/contexts/apiProxy/domain/account-selection/account-health-tracker'

function mk(now: { t: number }) {
  return new AccountHealthTracker({ baseCooldownMs: 1000, maxBackoffMultiplier: 64, quotaResetMs: 3600000, rateLimitCooldownMs: 60000, probabilisticRetryChance: 0, clock: () => now.t, random: () => 1 })
}

describe('AccountHealthTracker.snapshot', () => {
  it('未知账号 → available', () => {
    expect(mk({ t: 0 }).snapshot('a')).toMatchObject({ accountId: 'a', runtimeState: 'available', failureCount: 0 })
  })
  it('markSuspended → suspended（优先级最高）', () => {
    const now = { t: 0 }; const h = mk(now); h.markRateLimited('a'); h.markSuspended('a')
    expect(h.snapshot('a').runtimeState).toBe('suspended')
  })
  it('markRateLimited → rate_limited + 恢复时间戳（短冷却）', () => {
    const now = { t: 5 }; const h = mk(now); h.markRateLimited('a')
    expect(h.snapshot('a')).toMatchObject({ runtimeState: 'rate_limited', rateLimitedUntilMs: 5 + 60000 })
  })
  it('markQuotaExhausted → quota_exhausted + 时间戳（真配额耗尽）', () => {
    const now = { t: 5 }; const h = mk(now); h.markQuotaExhausted('a')
    expect(h.snapshot('a')).toMatchObject({ runtimeState: 'quota_exhausted', quotaExhaustedAtMs: 5 })
  })
  it('markFailure → cooldown + 截止', () => {
    const now = { t: 0 }; const h = mk(now); h.markFailure('a') // cooldown 1000
    expect(h.snapshot('a')).toMatchObject({ runtimeState: 'cooldown', cooldownUntilMs: 1000 })
  })
  it('冷却过期 → available', () => {
    const now = { t: 0 }; const h = mk(now); h.markFailure('a'); now.t = 1000
    expect(h.snapshot('a').runtimeState).toBe('available')
  })
  it('snapshotAll 批量', () => {
    const h = mk({ t: 0 }); h.markSuspended('b')
    const all = h.snapshotAll(['a', 'b'])
    expect(all.map((x) => x.runtimeState)).toEqual(['available', 'suspended'])
  })
})
