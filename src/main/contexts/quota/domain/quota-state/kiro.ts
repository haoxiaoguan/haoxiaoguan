// Kiro profile-payload parser.

import type { JsonValue } from '../../../account/domain/platform-account-profile'
import {
  AccountQuotaState,
  pickBool,
  pickNumber,
  pickString,
  pickTimestamp,
  quotaUsageMetric,
  statusFromMetrics,
  sanitizeProviderPayload,
  type QuotaMetric,
} from './model'

// Returns true when the payload carries overageConfiguration.overageStatus
// (or a top-level overageStatus) equal to 'ENABLED' — the raw getUsageLimits
// shape. Returns undefined when the field is absent so callers can fall through.
function overageStatusEnabled(payload: JsonValue | undefined): boolean | undefined {
  if (payload === undefined) return undefined
  const status = pickString(payload, [
    ['overageConfiguration', 'overageStatus'],
    ['overageStatus'],
  ])
  if (status === undefined) return undefined
  return status.trim().toUpperCase() === 'ENABLED'
}

export function stateFromProfile(
  profilePayload: JsonValue,
  credentialRawMetadata: JsonValue | undefined,
): AccountQuotaState | undefined {
  const creditsTotal =
    pickNumber(profilePayload, [
      ['creditsTotal'],
      ['credits', 'total'],
      ['estimatedUsage', 'total'],
      ['usageBreakdowns', 'plan', 'totalCredits'],
      ['usageBreakdowns', 'covered', 'total'],
      ['usageBreakdownList', '0', 'usageLimit'],
      ['usageBreakdownList', '0', 'usageLimitWithPrecision'],
    ]) ??
    pickNumber(credentialRawMetadata, [
      ['creditsTotal'],
      ['credits', 'total'],
      ['estimatedUsage', 'total'],
      ['usageBreakdowns', 'plan', 'totalCredits'],
      ['usageBreakdowns', 'covered', 'total'],
      ['usageBreakdownList', '0', 'usageLimit'],
      ['usageBreakdownList', '0', 'usageLimitWithPrecision'],
    ])
  const creditsUsed =
    pickNumber(profilePayload, [
      ['creditsUsed'],
      ['credits', 'used'],
      ['estimatedUsage', 'used'],
      ['usageBreakdowns', 'plan', 'usedCredits'],
      ['usageBreakdowns', 'covered', 'used'],
      ['usageBreakdownList', '0', 'currentUsage'],
      ['usageBreakdownList', '0', 'currentUsageWithPrecision'],
    ]) ??
    pickNumber(credentialRawMetadata, [
      ['creditsUsed'],
      ['credits', 'used'],
      ['estimatedUsage', 'used'],
      ['usageBreakdowns', 'plan', 'usedCredits'],
      ['usageBreakdowns', 'covered', 'used'],
      ['usageBreakdownList', '0', 'currentUsage'],
      ['usageBreakdownList', '0', 'currentUsageWithPrecision'],
    ])
  const bonusTotal =
    pickNumber(profilePayload, [
      ['bonusTotal'],
      ['bonusCredits', 'total'],
      ['bonus', 'total'],
      ['usageBreakdowns', 'bonus', 'total'],
    ]) ??
    pickNumber(credentialRawMetadata, [
      ['bonusTotal'],
      ['bonusCredits', 'total'],
      ['bonus', 'total'],
      ['usageBreakdowns', 'bonus', 'total'],
    ])
  const bonusUsed =
    pickNumber(profilePayload, [
      ['bonusUsed'],
      ['bonusCredits', 'used'],
      ['bonus', 'used'],
      ['usageBreakdowns', 'bonus', 'used'],
    ]) ??
    pickNumber(credentialRawMetadata, [
      ['bonusUsed'],
      ['bonusCredits', 'used'],
      ['bonus', 'used'],
      ['usageBreakdowns', 'bonus', 'used'],
    ])
  const resetAt =
    pickTimestamp(profilePayload, [
      ['usageResetAt'],
      ['resetAt'],
      ['resetTime'],
      ['resetOn'],
    ]) ??
    pickTimestamp(credentialRawMetadata, [
      ['usageResetAt'],
      ['resetAt'],
      ['resetTime'],
      ['resetOn'],
    ])

  // Overage: when the account has overage ENABLED, surface a SECOND metric for
  // the overage ceiling (e.g. Pro+ with overage can spend up to overageCap=10000
  // past the base 2000). overageCap is the spend ceiling, not the plan's included
  // credits — so it is its own metric, not a replacement for the base credits.
  const overageEnabled =
    pickBool(profilePayload, [['overageEnabled']]) ??
    pickBool(credentialRawMetadata, [['overageEnabled']]) ??
    overageStatusEnabled(profilePayload) ??
    overageStatusEnabled(credentialRawMetadata) ??
    false
  const overageCap =
    pickNumber(profilePayload, [
      ['overageCap'],
      ['usageBreakdownList', '0', 'overageCap'],
      ['overageConfiguration', 'overageLimit'],
    ]) ??
    pickNumber(credentialRawMetadata, [
      ['overageCap'],
      ['usageBreakdownList', '0', 'overageCap'],
    ])
  const overageUsed =
    pickNumber(profilePayload, [
      ['overageUsed'],
      ['usageBreakdownList', '0', 'currentOverages'],
    ]) ??
    pickNumber(credentialRawMetadata, [
      ['overageUsed'],
      ['usageBreakdownList', '0', 'currentOverages'],
    ])

  const metrics: QuotaMetric[] = []
  const credits = quotaUsageMetric('credits', 'Credits', creditsUsed, creditsTotal, 'credits', resetAt)
  if (credits) metrics.push(credits)
  if (overageEnabled && overageCap !== undefined) {
    const overage = quotaUsageMetric(
      'overage_credits',
      '超额额度',
      overageUsed,
      overageCap,
      'credits',
      resetAt,
    )
    if (overage) metrics.push(overage)
  }
  const bonus = quotaUsageMetric('bonus_credits', 'Bonus Credits', bonusUsed, bonusTotal, 'credits', undefined)
  if (bonus) metrics.push(bonus)
  if (metrics.length === 0) return undefined

  return new AccountQuotaState({
    version: 1,
    status: statusFromMetrics(metrics),
    primaryMetricKey: metrics[0]?.key,
    metrics,
    fetchedAt: undefined,
    error: undefined,
    providerPayload: sanitizeProviderPayload(profilePayload),
  })
}
