// Codex profile-payload parser.

import type { JsonValue } from '../../../account/domain/platform-account-profile'
import {
  pickBoolAny,
  pickNumberAny,
  pickTimestampAny,
  percentRemainingMetricWithReset,
  stateFromMetrics,
  type AccountQuotaState,
  type QuotaMetric,
} from './model'

// 主动重置次数（rate_limit_reset_credits.available_count）展示为一条无进度条的
// 计数信息行：kind=balance、无 percent → 渲染层不画进度条，仅显示 "N 次"。
function resetCreditsMetric(count: number): QuotaMetric {
  return {
    key: 'codex_reset_credits',
    label: '主动重置次数',
    kind: 'balance',
    unit: 'none',
    used: undefined,
    total: undefined,
    remaining: count,
    percentUsed: undefined,
    percentRemaining: undefined,
    displayValue: `${count} 次`,
    window: undefined,
    resetAt: undefined,
    status: 'ok',
  }
}

export function stateFromProfile(
  profilePayload: JsonValue,
  credentialRawMetadata: JsonValue | undefined,
): AccountQuotaState | undefined {
  const metrics: QuotaMetric[] = []

  const hourlyPresent = pickBoolAny(profilePayload, credentialRawMetadata, [
    ['quota', 'hourly_window_present'],
    ['quota', 'hourlyWindowPresent'],
  ])
  if (hourlyPresent !== false) {
    const metric = percentRemainingMetricWithReset(
      'codex_hourly',
      codexWindowLabel(
        pickNumberAny(profilePayload, credentialRawMetadata, [
          ['quota', 'hourly_window_minutes'],
          ['quota', 'hourlyWindowMinutes'],
        ]),
        '5小时额度',
      ),
      pickNumberAny(profilePayload, credentialRawMetadata, [
        ['quota', 'hourly_percentage'],
        ['quota', 'hourlyPercentage'],
      ]),
      pickTimestampAny(profilePayload, credentialRawMetadata, [
        ['quota', 'hourly_reset_time'],
        ['quota', 'hourlyResetTime'],
      ]),
      'hour',
    )
    if (metric) metrics.push(metric)
  }

  const weeklyPresent = pickBoolAny(profilePayload, credentialRawMetadata, [
    ['quota', 'weekly_window_present'],
    ['quota', 'weeklyWindowPresent'],
  ])
  if (weeklyPresent !== false) {
    const metric = percentRemainingMetricWithReset(
      'codex_weekly',
      codexWindowLabel(
        pickNumberAny(profilePayload, credentialRawMetadata, [
          ['quota', 'weekly_window_minutes'],
          ['quota', 'weeklyWindowMinutes'],
        ]),
        '周额度',
      ),
      pickNumberAny(profilePayload, credentialRawMetadata, [
        ['quota', 'weekly_percentage'],
        ['quota', 'weeklyPercentage'],
      ]),
      pickTimestampAny(profilePayload, credentialRawMetadata, [
        ['quota', 'weekly_reset_time'],
        ['quota', 'weeklyResetTime'],
      ]),
      'billing_cycle',
    )
    if (metric) metrics.push(metric)
  }

  // 主动重置次数：available_count 存在即展示（含 0，表示当前无可用重置次数）。
  const resetCredits = pickNumberAny(profilePayload, credentialRawMetadata, [
    ['quota', 'reset_credits_available'],
    ['quota', 'resetCreditsAvailable'],
  ])
  if (resetCredits !== undefined) {
    metrics.push(resetCreditsMetric(Math.max(0, Math.round(resetCredits))))
  }

  return stateFromMetrics(metrics, profilePayload)
}

function codexWindowLabel(minutes: number | undefined, fallback: string): string {
  if (minutes === undefined) return fallback
  if (Math.abs(minutes - 300) < Number.EPSILON) return '5小时额度'
  if (Math.abs(minutes - 10080) < Number.EPSILON) return '周额度'
  if (minutes >= 1440 && Math.abs(minutes % 1440) < Number.EPSILON) {
    return `${(minutes / 1440).toFixed(0)}天额度`
  }
  if (minutes >= 60 && Math.abs(minutes % 60) < Number.EPSILON) {
    return `${(minutes / 60).toFixed(0)}小时额度`
  }
  return `${minutes.toFixed(0)}分钟额度`
}
