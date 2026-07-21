// Cursor「额度用尽自动退款」的纯逻辑门控 + 状态机。
//
// 无副作用、可单测：决定「本次配额刷新是否应对该 Cursor 账号自动发起退款」。
// 实际的退款调用/持久化/通知在 application 层（cursor-auto-refund-consumer.ts）。

import type { JsonValue } from './platform-account-profile'

/** profilePayload 里记录上次自动退款结果状态的 key。 */
const AUTO_REFUND_STATUS_KEY = 'autoRefundStatus'

function isPlainObject(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 排除档：免费/试用/团队/企业，命中即绝不退款。 */
function isExcludedTier(v: string): boolean {
  return v.length > 0 && /free|trial|team|enterprise|business/.test(v)
}

/**
 * 是否为「可退款的付费个人号」。两个信号不对称：
 *   - membershipType 是**实时**值（配额刷新每轮读取），planTier 是**导入时冻结**值（刷新从不回写）。
 *   - 任一信号（实时 or 冻结）命中 free/trial/team/enterprise/business → false（并集排除，防已降级/转团队号）。
 *   - **只有实时 membershipType 明确是 pro/ultra 才放行**；冻结 planTier 不能单独放行。
 *
 * 为何不许 planTier 单独放行：Cursor fetcher 取不到 membership 时会把 membershipType 写成 null →
 * 门控只剩冻结的 planTier。一个导入时为 Pro、之后降级/转团队/企业的号，在「membership 缺失 + 计划额度
 * 耗尽」的那次刷新里，若允许 planTier='pro' 单独放行就会误退错号（不可逆）。故缺实时付费信号时宁可漏退
 * （用户可手动退、或下轮 membership 可读时再退），也不凭陈旧 planTier 误退。
 */
export function isRefundablePaidTier(
  planTier: string | undefined,
  membershipType: string | undefined,
): boolean {
  const live = (typeof membershipType === 'string' ? membershipType : '').trim().toLowerCase()
  const frozen = (typeof planTier === 'string' ? planTier : '').trim().toLowerCase()
  if (isExcludedTier(live) || isExcludedTier(frozen)) return false
  return /pro|ultra/.test(live)
}

/**
 * 是否为「终态」——已到此态则不再自动退款：
 *   success / already_free / pending → true（已成功 / 本就 Free / 已提交同步中）；
 *   failed / ratelimited / 其它 / 空 → false（可重试）。
 */
export function isTerminalRefundState(status: string | undefined): boolean {
  return status === 'success' || status === 'already_free' || status === 'pending'
}

/**
 * 从 profilePayload 读上次自动退款状态。仅当 payload 是 plain object 且
 * autoRefundStatus 值为 string 时返回该字符串，否则 undefined。
 */
export function readAutoRefundStatus(profilePayload: JsonValue): string | undefined {
  if (!isPlainObject(profilePayload)) return undefined
  const value = profilePayload[AUTO_REFUND_STATUS_KEY]
  return typeof value === 'string' ? value : undefined
}

/**
 * 是否应对该账号发起一次自动退款：开关开 + 计划额度耗尽 + 付费个人号 + 上次不在终态。
 *
 * quotaExhausted 必须是「**计划额度**（total_usage 指标）耗尽」，而非配额聚合态——聚合态是
 * 「任一子指标耗尽」，会被 on_demand（按需消费封顶）等子桶打满误触发。判定在配额 seam 完成后传入。
 */
export function shouldAttemptAutoRefund(input: {
  enabled: boolean
  quotaExhausted: boolean
  planTier?: string | undefined
  membershipType?: string | undefined
  lastStatus?: string | undefined
}): boolean {
  return (
    input.enabled &&
    input.quotaExhausted &&
    isRefundablePaidTier(input.planTier, input.membershipType) &&
    !isTerminalRefundState(input.lastStatus)
  )
}
