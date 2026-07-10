import { describe, it, expect } from 'vitest'
import {
  isRefundablePaidTier,
  isTerminalRefundState,
  readAutoRefundStatus,
  shouldAttemptAutoRefund,
} from '../../../src/main/contexts/account/domain/cursor-auto-refund-policy'

describe('isRefundablePaidTier', () => {
  it('放行付费个人档 pro / pro_plus / ultra', () => {
    expect(isRefundablePaidTier('pro', undefined)).toBe(true)
    expect(isRefundablePaidTier('pro_plus', undefined)).toBe(true)
    expect(isRefundablePaidTier('ultra', undefined)).toBe(true)
    // 大小写不敏感。
    expect(isRefundablePaidTier('PRO', undefined)).toBe(true)
    expect(isRefundablePaidTier('Ultra', undefined)).toBe(true)
  })

  it('拒绝 free / trial / team / enterprise / business / 空', () => {
    expect(isRefundablePaidTier('free', undefined)).toBe(false)
    expect(isRefundablePaidTier('free_trial', undefined)).toBe(false)
    expect(isRefundablePaidTier('trial', undefined)).toBe(false)
    expect(isRefundablePaidTier('team', undefined)).toBe(false)
    expect(isRefundablePaidTier('enterprise', undefined)).toBe(false)
    expect(isRefundablePaidTier('business', undefined)).toBe(false)
    expect(isRefundablePaidTier('', undefined)).toBe(false)
    expect(isRefundablePaidTier(undefined, undefined)).toBe(false)
  })

  it('排除词优先于付费词（如 team 里即便含 pro 也拒）', () => {
    // enterprise pro plan：命中排除词 enterprise → 拒。
    expect(isRefundablePaidTier('enterprise_pro', undefined)).toBe(false)
    // business 优先。
    expect(isRefundablePaidTier('business_pro', undefined)).toBe(false)
  })

  it('单信号存在时按该信号判定', () => {
    expect(isRefundablePaidTier(undefined, 'pro')).toBe(true)
    expect(isRefundablePaidTier(undefined, 'ultra')).toBe(true)
    expect(isRefundablePaidTier(undefined, 'free')).toBe(false)
    expect(isRefundablePaidTier('', 'pro')).toBe(true)
  })

  it('两信号取并集排除：任一是 free/team/企业就拒（防过期 planTier 误退）', () => {
    // 关键危险方向：导入时冻结 planTier='pro'，在线刷新后 membershipType='team' → 必须拒。
    expect(isRefundablePaidTier('pro', 'team')).toBe(false)
    expect(isRefundablePaidTier('pro', 'enterprise')).toBe(false)
    // 降级：planTier 停在 pro，membershipType 已变 free → 拒。
    expect(isRefundablePaidTier('pro', 'free')).toBe(false)
    // 反向同理（membershipType 付费但 planTier 是团队/免费）→ 拒。
    expect(isRefundablePaidTier('team', 'pro')).toBe(false)
    expect(isRefundablePaidTier('free', 'pro')).toBe(false)
    // 两信号都指向付费个人 → 放行。
    expect(isRefundablePaidTier('pro', 'pro_plus')).toBe(true)
    expect(isRefundablePaidTier('pro', undefined)).toBe(true)
  })

  it('未知非付费档 → false', () => {
    expect(isRefundablePaidTier('hobby', undefined)).toBe(false)
    expect(isRefundablePaidTier('basic', undefined)).toBe(false)
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
    membershipType: undefined as string | undefined,
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

  it('非付费个人号 → false', () => {
    expect(shouldAttemptAutoRefund({ ...base, planTier: 'free' })).toBe(false)
    expect(shouldAttemptAutoRefund({ ...base, planTier: 'team' })).toBe(false)
    expect(shouldAttemptAutoRefund({ ...base, planTier: undefined })).toBe(false)
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

  it('membershipType 兜底放行付费档', () => {
    expect(
      shouldAttemptAutoRefund({ ...base, planTier: undefined, membershipType: 'ultra' }),
    ).toBe(true)
  })
})
