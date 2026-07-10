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

/**
 * 是否为「可退款的付费个人号」。**同时**看 planTier 与 membershipType 两个信号（不是取第一个）：
 *   - 任一信号命中 free / trial / team / enterprise / business → false（免费/试用/团队/企业均不退）；
 *   - 至少一个信号命中 pro / ultra → true（pro / pro_plus / ultra 付费个人档）；
 *   - 否则 false（含两者皆空）。
 *
 * 之所以「任一命中排除词就拒」而非「取第一个非空值判定」：planTier 是导入时冻结的（在线刷新只更新
 * membershipType，不回写 planTier），一个导入时为 pro、之后变 team/企业或降级 free 的号，planTier 会
 * 停留在旧的 pro。若只信 planTier 会误退这类号。退款不可逆，故对排除方向取两信号的并集（更保守：
 * 宁可漏退一个真付费个人号——用户可手动退——也不误退团队/企业/已降级号）。
 */
export function isRefundablePaidTier(
  planTier: string | undefined,
  membershipType: string | undefined,
): boolean {
  const signals = [planTier, membershipType]
    .map((v) => (typeof v === 'string' ? v.trim().toLowerCase() : ''))
    .filter((v) => v.length > 0)
  if (signals.length === 0) return false
  if (signals.some((v) => /free|trial|team|enterprise|business/.test(v))) return false
  return signals.some((v) => /pro|ultra/.test(v))
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
