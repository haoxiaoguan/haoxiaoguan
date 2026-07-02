// Antigravity profile-payload parser.
//
// Antigravity quota comes from CloudCode retrieveUserQuotaSummary:
//   antigravity_quota_summary_raw.groups[].buckets[]
//     { bucketId, displayName, remainingFraction (0..1), resetTime }.
// Each bucket → a percent-remaining metric (fraction*100) with reset time.
// Falls back to the generic profile state when no buckets are present.

import type { JsonValue } from '../../../account/domain/platform-account-profile'
import {
  genericStateFromProfile,
  percentRemainingMetricWithReset,
  pickNumber,
  pickString,
  pickTimestamp,
  pickValueAny,
  stateFromMetrics,
  type AccountQuotaState,
  type QuotaMetric,
} from './model'

export function stateFromProfile(
  profilePayload: JsonValue,
  credentialRawMetadata: JsonValue | undefined,
): AccountQuotaState | undefined {
  const metrics = bucketMetrics(profilePayload, credentialRawMetadata)
  return (
    stateFromMetrics(metrics, profilePayload) ??
    genericStateFromProfile(profilePayload, credentialRawMetadata)
  )
}

function bucketMetrics(
  profilePayload: JsonValue,
  credentialRawMetadata: JsonValue | undefined,
): QuotaMetric[] {
  const groups = pickValueAny(profilePayload, credentialRawMetadata, [
    ['antigravity_quota_summary_raw', 'groups'],
    ['antigravityQuotaSummaryRaw', 'groups'],
    ['quota_summary', 'groups'],
  ])
  if (!Array.isArray(groups)) return []

  const metrics: QuotaMetric[] = []
  let index = 0
  for (const group of groups) {
    const buckets = pickValueAny(group, undefined, [['buckets']])
    if (!Array.isArray(buckets)) continue
    for (const bucket of buckets) {
      const fraction = pickNumber(bucket, [
        ['remainingFraction'],
        ['remaining_fraction'],
        ['remainingPercent'],
      ])
      if (fraction === undefined) continue
      const remaining = fraction <= 1.0 ? fraction * 100.0 : fraction
      const label =
        pickString(bucket, [['displayName'], ['display_name'], ['bucketId'], ['bucket_id']]) ??
        `Quota ${index + 1}`
      const key =
        pickString(bucket, [['bucketId'], ['bucket_id']]) ?? label.toLowerCase().replace(/\s+/g, '_')
      const resetAt = pickTimestamp(bucket, [['resetTime'], ['reset_time'], ['resetAt']])
      const metric = percentRemainingMetricWithReset(key, label, remaining, resetAt, undefined)
      if (metric) metrics.push(metric)
      index += 1
    }
  }
  return metrics
}
