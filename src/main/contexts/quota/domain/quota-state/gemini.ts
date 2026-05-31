// Gemini CLI profile-payload parser. 对应 quota_state/gemini.rs.

import type { JsonValue } from '../../../account/domain/platform-account-profile'
import {
  genericStateFromProfile,
  percentRemainingMetric,
  percentRemainingMetricWithReset,
  pickNumber,
  pickNumberAny,
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
  const metrics: QuotaMetric[] = []
  for (const [key, label] of [
    ['pro', 'Pro'],
    ['flash', 'Flash'],
  ] as const) {
    const metric = percentRemainingMetric(
      key,
      label,
      pickNumberAny(profilePayload, credentialRawMetadata, [
        ['quota', key, 'remainingPercent'],
        ['usage', key, 'remainingPercent'],
        [key, 'remainingPercent'],
        ['quota', key, 'percentRemaining'],
      ]),
    )
    if (metric) metrics.push(metric)
  }
  if (metrics.length === 0) {
    metrics.push(...geminiBucketMetrics(profilePayload, credentialRawMetadata))
  }

  return (
    stateFromMetrics(metrics, profilePayload) ??
    genericStateFromProfile(profilePayload, credentialRawMetadata)
  )
}

function geminiBucketMetrics(
  profilePayload: JsonValue,
  credentialRawMetadata: JsonValue | undefined,
): QuotaMetric[] {
  const value = pickValueAny(profilePayload, credentialRawMetadata, [
    ['gemini_usage_raw', 'buckets'],
    ['geminiUsageRaw', 'buckets'],
  ])
  if (!Array.isArray(value)) return []
  const buckets = value

  const metrics: QuotaMetric[] = []
  for (const [key, label, needle] of [
    ['pro', 'Pro', 'pro'],
    ['flash', 'Flash', 'flash'],
  ] as const) {
    let best: { remaining: number; resetAt?: Date } | undefined
    for (const bucket of buckets) {
      const model = pickString(bucket, [['modelId'], ['model_id'], ['name']])
      if (model === undefined || !model.toLowerCase().includes(needle)) continue
      const rawRemaining = pickNumber(bucket, [
        ['remainingPercent'],
        ['percent_remaining'],
        ['remaining_percentage'],
        ['remainingFraction'],
      ])
      if (rawRemaining === undefined) continue
      const remaining = rawRemaining <= 1.0 ? rawRemaining * 100.0 : rawRemaining
      const resetAt = pickTimestamp(bucket, [['resetTime'], ['reset_time'], ['resetAt']])
      if (best === undefined || remaining < best.remaining) {
        best = { remaining, resetAt }
      }
    }
    if (best !== undefined) {
      const metric = percentRemainingMetricWithReset(key, label, best.remaining, best.resetAt, 'day')
      if (metric) metrics.push(metric)
    }
  }
  return metrics
}
