import { describe, it, expect } from 'vitest'
import { parseQuota } from '../../../src/main/contexts/quota/infrastructure/http/codex'
import { stateFromProfile } from '../../../src/main/contexts/quota/domain/quota-state/codex'

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

// 主动重置次数（rate_limit_reset_credits.available_count）：随 wham/usage 一起返回，
// parseQuota 抽到 reset_credits_available，quota-state 再渲染成一条 "N 次" 信息指标。
describe('parseQuota + stateFromProfile — 主动重置次数', () => {
  it('提取 rate_limit_reset_credits.available_count', () => {
    const usage = {
      plan_type: 'pro',
      rate_limit: {
        primary_window: { limit_window_seconds: 18000, used_percent: 20 },
        secondary_window: { limit_window_seconds: 604800, used_percent: 40 },
      },
      rate_limit_reset_credits: { available_count: 3 },
    }
    const q = parseQuota(usage) as Record<string, unknown>
    expect(q.reset_credits_available).toBe(3)
  })

  it('无 rate_limit_reset_credits → reset_credits_available 为 null', () => {
    const q = parseQuota({ plan_type: 'free', rate_limit: {} }) as Record<string, unknown>
    expect(q.reset_credits_available).toBeNull()
  })

  it('stateFromProfile 生成一条 codex_reset_credits 指标（无进度、显示 "N 次"）', () => {
    const usage = {
      rate_limit: {
        primary_window: { limit_window_seconds: 18000, used_percent: 20, reset_at: 1893456000 },
        secondary_window: { limit_window_seconds: 604800, used_percent: 40, reset_at: 1893456000 },
      },
      rate_limit_reset_credits: { available_count: 5 },
    }
    const quota = parseQuota(usage)
    const state = stateFromProfile({ quota } as never, undefined)
    expect(state).toBeDefined()
    const reset = state!.metrics.find((m) => m.key === 'codex_reset_credits')
    expect(reset).toBeDefined()
    expect(reset!.displayValue).toBe('5 次')
    expect(reset!.percentUsed).toBeUndefined()
    expect(reset!.percentRemaining).toBeUndefined()
    // 不应抢占主指标（主指标仍是 5 小时窗口）。
    expect(state!.primaryMetricKey).toBe('codex_hourly')
  })

  it('available_count=0 也展示（当前无可用重置次数）', () => {
    const usage = {
      rate_limit: { primary_window: { limit_window_seconds: 18000, used_percent: 0 } },
      rate_limit_reset_credits: { available_count: 0 },
    }
    const state = stateFromProfile({ quota: parseQuota(usage) } as never, undefined)
    const reset = state!.metrics.find((m) => m.key === 'codex_reset_credits')
    expect(reset?.displayValue).toBe('0 次')
  })
})
