// GitHub Copilot / Windsurf profile-payload parser.
// Used for both PlatformId Cursor's sibling GithubCopilot and Windsurf (snapshots
// schema is shared).

import type { JsonValue } from '../../../account/domain/platform-account-profile'
import {
  entitlementMetric,
  getPathValue,
  percentRemainingMetricWithReset,
  pickNumber,
  pickStringAny,
  pickTimestampAny,
  pickValueAny,
  quotaUsageMetricWithRemaining,
  stateFromMetrics,
  valueToF64,
  type AccountQuotaState,
  type QuotaMetric,
} from './model'

export function stateFromProfile(
  profilePayload: JsonValue,
  credentialRawMetadata: JsonValue | undefined,
): AccountQuotaState | undefined {
  const metrics = copilotMetricsFromProfile(profilePayload, credentialRawMetadata)
  if (metrics.length > 0) {
    return stateFromMetrics(metrics, profilePayload)
  }

  const display =
    pickStringAny(profilePayload, credentialRawMetadata, [
      ['planName'],
      ['copilotPlan'],
      ['copilot_plan'],
      ['plan', 'name'],
      ['subscription', 'name'],
      ['entitlement', 'name'],
    ]) ?? '已授权'
  return stateFromMetrics([entitlementMetric('entitlement', 'Copilot', display)], profilePayload)
}

function copilotMetricsFromProfile(
  profilePayload: JsonValue,
  credentialRawMetadata: JsonValue | undefined,
): QuotaMetric[] {
  const resetAt = pickTimestampAny(profilePayload, credentialRawMetadata, [
    ['copilot_limited_user_reset_date'],
    ['copilotLimitedUserResetDate'],
    ['copilot_quota_reset_date'],
    ['copilotQuotaResetDate'],
  ])
  const snapshots = pickValueAny(profilePayload, credentialRawMetadata, [
    ['copilot_quota_snapshots'],
    ['copilotQuotaSnapshots'],
  ])
  const limited = pickValueAny(profilePayload, credentialRawMetadata, [
    ['copilot_limited_user_quotas'],
    ['copilotLimitedUserQuotas'],
  ])

  const metrics: QuotaMetric[] = []
  const inline = copilotUsageMetric(
    'inline_suggestions',
    'Inline Suggestions',
    snapshotForKey(snapshots, 'completions'),
    limited !== undefined ? getPathValue(limited, ['completions']) : undefined,
    resetAt,
  )
  if (inline) metrics.push(inline)
  const chat = copilotUsageMetric(
    'chat_messages',
    'Chat Messages',
    snapshotForKey(snapshots, 'chat'),
    limited !== undefined ? getPathValue(limited, ['chat']) : undefined,
    resetAt,
  )
  if (chat) metrics.push(chat)
  const premium = copilotUsageMetric(
    'premium_requests',
    'Premium Requests',
    snapshotForKey(snapshots, 'premium_interactions') ??
      snapshotForKey(snapshots, 'premium_models'),
    undefined,
    undefined,
  )
  if (premium) metrics.push(premium)
  return metrics
}

function snapshotForKey(snapshots: JsonValue | undefined, key: string): JsonValue | undefined {
  if (snapshots === undefined || typeof snapshots !== 'object' || snapshots === null) return undefined
  if (Array.isArray(snapshots)) return undefined
  return snapshots[key]
}

function copilotUsageMetric(
  key: string,
  label: string,
  snapshot: JsonValue | undefined,
  limitedRemaining: JsonValue | undefined,
  resetAt: Date | undefined,
): QuotaMetric | undefined {
  if (
    snapshot !== undefined &&
    getPathValue(snapshot, ['unlimited']) === true
  ) {
    const metric = entitlementMetric(key, label, 'Included')
    metric.percentUsed = 0
    return metric
  }

  const total = pickNumber(snapshot, [['entitlement'], ['total'], ['limit']])
  let remaining = pickNumber(snapshot, [['remaining']])
  if (remaining === undefined && limitedRemaining !== undefined) {
    const candidate = valueToF64(limitedRemaining)
    if (candidate !== undefined && Number.isFinite(candidate)) remaining = candidate
  }

  const usageMetric = quotaUsageMetricWithRemaining(
    key,
    label,
    undefined,
    total,
    remaining,
    'requests',
    resetAt,
  )
  if (usageMetric) return usageMetric

  return percentRemainingMetricWithReset(
    key,
    label,
    pickNumber(snapshot, [['percent_remaining'], ['percentRemaining'], ['remainingPercent']]),
    resetAt,
    'billing_cycle',
  )
}
