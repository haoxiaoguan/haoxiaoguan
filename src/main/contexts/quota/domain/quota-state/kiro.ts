// Kiro profile-payload parser. 对应 quota_state/Rust模块.

import type { JsonValue } from '../../../account/domain/platform-account-profile'
import {
  AccountQuotaState,
  pickNumber,
  pickTimestamp,
  quotaUsageMetric,
  statusFromMetrics,
  sanitizeProviderPayload,
  type QuotaMetric,
} from './model'

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
    ]) ??
    pickNumber(credentialRawMetadata, [
      ['creditsTotal'],
      ['credits', 'total'],
      ['estimatedUsage', 'total'],
      ['usageBreakdowns', 'plan', 'totalCredits'],
      ['usageBreakdowns', 'covered', 'total'],
    ])
  const creditsUsed =
    pickNumber(profilePayload, [
      ['creditsUsed'],
      ['credits', 'used'],
      ['estimatedUsage', 'used'],
      ['usageBreakdowns', 'plan', 'usedCredits'],
      ['usageBreakdowns', 'covered', 'used'],
    ]) ??
    pickNumber(credentialRawMetadata, [
      ['creditsUsed'],
      ['credits', 'used'],
      ['estimatedUsage', 'used'],
      ['usageBreakdowns', 'plan', 'usedCredits'],
      ['usageBreakdowns', 'covered', 'used'],
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

  const metrics: QuotaMetric[] = []
  const credits = quotaUsageMetric('credits', 'Credits', creditsUsed, creditsTotal, 'credits', resetAt)
  if (credits) metrics.push(credits)
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
