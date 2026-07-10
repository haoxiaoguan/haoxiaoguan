import { describe, it, expect } from 'vitest'
import {
  isRefundablePaidTier,
  isTerminalRefundState,
  readAutoRefundStatus,
  shouldAttemptAutoRefund,
} from '../../../src/main/contexts/account/domain/cursor-auto-refund-policy'

describe('isRefundablePaidTier', () => {
  it('实时 membershipType 明确付费个人档才放行（大小写不敏感）', () => {
    expect(isRefundablePaidTier(undefined, 'pro')).toBe(true)
    expect(isRefundablePaidTier(undefined, 'pro_plus')).toBe(true)
    expect(isRefundablePaidTier(undefined, 'ultra')).toBe(true)
    expect(isRefundablePaidTier(undefined, 'PRO')).toBe(true)
    expect(isRefundablePaidTier('pro', 'pro')).toBe(true) // planTier 也在，一致
    expect(isRefundablePaidTier('', 'ultra')).toBe(true)
  })

  it('P1：缺实时 membershipType 时，绝不凭冻结 planTier 单独放行', () => {
    // 核心风险：导入时冻结 planTier='pro'，本次刷新 membership 读不到（写成 null/缺失）
    // → 账号可能已降级/转团队，不能只凭陈旧 planTier 退款。
    expect(isRefundablePaidTier('pro', undefined)).toBe(false)
    expect(isRefundablePaidTier('pro_plus', undefined)).toBe(false)
    expect(isRefundablePaidTier('ultra', undefined)).toBe(false)
    expect(isRefundablePaidTier('PRO', '')).toBe(false)
  })

  it('实时 membershipType 非付费 → false', () => {
    expect(isRefundablePaidTier(undefined, 'free')).toBe(false)
    expect(isRefundablePaidTier(undefined, 'free_trial')).toBe(false)
    expect(isRefundablePaidTier(undefined, 'team')).toBe(false)
    expect(isRefundablePaidTier(undefined, 'enterprise')).toBe(false)
    expect(isRefundablePaidTier(undefined, 'hobby')).toBe(false)
    expect(isRefundablePaidTier(undefined, undefined)).toBe(false)
    expect(isRefundablePaidTier('', '')).toBe(false)
  })

  it('任一信号（实时或冻结）命中排除词 → 拒（防已降级/转团队号）', () => {
    // 实时 membership 说 team/企业/free → 拒（即便 planTier 冻结为 pro）。
    expect(isRefundablePaidTier('pro', 'team')).toBe(false)
    expect(isRefundablePaidTier('pro', 'enterprise')).toBe(false)
    expect(isRefundablePaidTier('pro', 'free')).toBe(false)
    // 冻结 planTier 是 team/free（即便实时 membership 是 pro）→ 也拒（历史排除信号）。
    expect(isRefundablePaidTier('team', 'pro')).toBe(false)
    expect(isRefundablePaidTier('free', 'pro')).toBe(false)
    expect(isRefundablePaidTier('enterprise_pro', 'pro')).toBe(false) // 冻结含 enterprise
    // 都指向付费个人 → 放行。
    expect(isRefundablePaidTier('pro', 'pro_plus')).toBe(true)
  })
})

describe('isTerminalRefundState', () => {
  it('success / already_free / pending 为终态 → true', () => {
    expect(isTerminalRefundState('success')).toBe(true)
    expect(isTerminalRefundState('already_free')).toBe(true)
    expect(isTerminalRefundState('pending')).toBe(true)
  })

  it('failed / ratelimited / 其它 / undefined 可重试 → false', () => {
    expect(isTerminalRefundState('failed')).toBe(false)
    expect(isTerminalRefundState('ratelimited')).toBe(false)
    expect(isTerminalRefundState('whatever')).toBe(false)
    expect(isTerminalRefundState(undefined)).toBe(false)
  })
})

describe('readAutoRefundStatus', () => {
  it('plain object 且值为 string 时返回', () => {
    expect(readAutoRefundStatus({ autoRefundStatus: 'success' })).toBe('success')
    expect(readAutoRefundStatus({ autoRefundStatus: 'failed', other: 1 })).toBe('failed')
  })

  it('非 plain object / 缺键 / 非字符串值 → undefined', () => {
    expect(readAutoRefundStatus(null)).toBeUndefined()
    expect(readAutoRefundStatus('success')).toBeUndefined()
    expect(readAutoRefundStatus(['success'])).toBeUndefined()
    expect(readAutoRefundStatus({})).toBeUndefined()
    expect(readAutoRefundStatus({ autoRefundStatus: 123 })).toBeUndefined()
    expect(readAutoRefundStatus({ autoRefundStatus: null })).toBeUndefined()
  })
})

describe('shouldAttemptAutoRefund', () => {
  const base = {
    enabled: true,
    quotaExhausted: true,
    planTier: 'pro',
    membershipType: 'pro' as string | undefined, // 实时付费信号（放行前提）
    lastStatus: undefined as string | undefined,
  }

  it('全条件满足 → true', () => {
    expect(shouldAttemptAutoRefund(base)).toBe(true)
  })

  it('开关关 → false', () => {
    expect(shouldAttemptAutoRefund({ ...base, enabled: false })).toBe(false)
  })

  it('计划额度未耗尽 → false', () => {
    expect(shouldAttemptAutoRefund({ ...base, quotaExhausted: false })).toBe(false)
  })

  it('非付费/缺实时付费信号 → false', () => {
    expect(shouldAttemptAutoRefund({ ...base, membershipType: 'free' })).toBe(false)
    expect(shouldAttemptAutoRefund({ ...base, membershipType: 'team' })).toBe(false)
    // 缺实时 membership、只有冻结 planTier=pro → 不退（P1）。
    expect(shouldAttemptAutoRefund({ ...base, membershipType: undefined })).toBe(false)
  })

  it('lastStatus 为终态 → false（不重复退）', () => {
    expect(shouldAttemptAutoRefund({ ...base, lastStatus: 'success' })).toBe(false)
    expect(shouldAttemptAutoRefund({ ...base, lastStatus: 'already_free' })).toBe(false)
    expect(shouldAttemptAutoRefund({ ...base, lastStatus: 'pending' })).toBe(false)
  })

  it('lastStatus 可重试态（failed/ratelimited）不阻挡 → true', () => {
    expect(shouldAttemptAutoRefund({ ...base, lastStatus: 'failed' })).toBe(true)
    expect(shouldAttemptAutoRefund({ ...base, lastStatus: 'ratelimited' })).toBe(true)
  })

  it('实时 membershipType 付费即放行（无需 planTier）', () => {
    expect(
      shouldAttemptAutoRefund({ ...base, planTier: undefined, membershipType: 'ultra' }),
    ).toBe(true)
  })
})
