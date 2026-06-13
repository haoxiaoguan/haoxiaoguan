import { describe, it, expect } from 'vitest'
import { parseQuota } from '../../../src/main/contexts/quota/infrastructure/http/codex'

// Codex usage 的 rate_limit：付费账号有 primary+secondary 两个窗口；free 账号 secondary_window
// 上游返回**显式 null**。回归守卫：null 必须判为「窗口不存在」(否则 free 仍显示空的周额度)。
describe('parseQuota — window present 判定', () => {
  it('free：secondary_window=null → 周窗口不存在(weekly_window_present=false)', () => {
    const usage = {
      plan_type: 'free',
      rate_limit: {
        primary_window: { limit_window_seconds: 2592000, reset_at: 1783966552, used_percent: 5 },
        secondary_window: null,
      },
    }
    const q = parseQuota(usage) as Record<string, unknown>
    expect(q.hourly_window_present).toBe(true)
    expect(q.weekly_window_present).toBe(false)
    expect(q.hourly_window_minutes).toBe(43200) // 2592000s = 30 天
    expect(q.hourly_percentage).toBe(95) // 100 - used 5
  })

  it('付费：primary+secondary 均为对象 → 两窗口都存在', () => {
    const usage = {
      plan_type: 'pro',
      rate_limit: {
        primary_window: { limit_window_seconds: 2592000, used_percent: 10 },
        secondary_window: { limit_window_seconds: 604800, used_percent: 0 },
      },
    }
    const q = parseQuota(usage) as Record<string, unknown>
    expect(q.hourly_window_present).toBe(true)
    expect(q.weekly_window_present).toBe(true)
    expect(q.weekly_window_minutes).toBe(10080) // 604800s = 7 天
    expect(q.weekly_percentage).toBe(100)
  })

  it('完全无 rate_limit → 两窗口都不存在', () => {
    const q = parseQuota({ plan_type: 'free' }) as Record<string, unknown>
    expect(q.hourly_window_present).toBe(false)
    expect(q.weekly_window_present).toBe(false)
  })
})
