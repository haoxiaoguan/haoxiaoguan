// Zed profile-payload parser.

import type { JsonValue } from '../../../account/domain/platform-account-profile'
import {
  genericStateFromProfile,
  pickNumberAny,
  quotaUsageMetricWithRemaining,
  stateFromMetrics,
  type AccountQuotaState,
  type QuotaMetric,
} from './model'

export function stateFromProfile(
  profilePayload: JsonValue,
  credentialRawMetadata: JsonValue | undefined,
): AccountQuotaState | undefined {
  const metrics: QuotaMetric[] = []

  const usedCents = pickNumberAny(profilePayload, credentialRawMetadata, [
    ['tokenSpendUsedCents'],
    ['token_spend_used_cents'],
    ['usage_raw', 'current_usage', 'token_spend', 'used'],
    ['usageRaw', 'current_usage', 'token_spend', 'used'],
  ])
  const limitCents = pickNumberAny(profilePayload, credentialRawMetadata, [
    ['tokenSpendLimitCents'],
    ['token_spend_limit_cents'],
    ['usage_raw', 'current_usage', 'token_spend', 'limit'],
    ['usageRaw', 'current_usage', 'token_spend', 'limit'],
  ])
  const remainingCents = pickNumberAny(profilePayload, credentialRawMetadata, [
    ['tokenSpendRemainingCents'],
    ['token_spend_remaining_cents'],
    ['usage_raw', 'current_usage', 'token_spend', 'remaining'],
    ['usageRaw', 'current_usage', 'token_spend', 'remaining'],
  ])
  const tokenSpend = quotaUsageMetricWithRemaining(
    'token_spend',
    'Token Spend',
    usedCents === undefined ? undefined : usedCents / 100.0,
    limitCents === undefined ? undefined : limitCents / 100.0,
    remainingCents === undefined ? undefined : remainingCents / 100.0,
    'usd',
    undefined,
  )
  if (tokenSpend) metrics.push(tokenSpend)

  const editLimit = pickNumberAny(profilePayload, credentialRawMetadata, [
    ['editPredictionsLimitRaw'],
    ['edit_predictions_limit_raw'],
    ['usage_raw', 'current_usage', 'edit_predictions', 'limit'],
    ['usageRaw', 'current_usage', 'edit_predictions', 'limit'],
  ])
  const editRemaining = pickNumberAny(profilePayload, credentialRawMetadata, [
    ['editPredictionsRemainingRaw'],
    ['edit_predictions_remaining_raw'],
    ['usage_raw', 'current_usage', 'edit_predictions', 'remaining'],
    ['usageRaw', 'current_usage', 'edit_predictions', 'remaining'],
  ])
  const editUsed = pickNumberAny(profilePayload, credentialRawMetadata, [
    ['editPredictionsUsed'],
    ['edit_predictions_used'],
    ['usage_raw', 'current_usage', 'edit_predictions', 'used'],
    ['usageRaw', 'current_usage', 'edit_predictions', 'used'],
  ])
  const editPredictions = quotaUsageMetricWithRemaining(
    'edit_predictions',
    'Edit Predictions',
    editUsed,
    editLimit,
    editRemaining,
    'requests',
    undefined,
  )
  if (editPredictions) metrics.push(editPredictions)

  return (
    stateFromMetrics(metrics, profilePayload) ??
    genericStateFromProfile(profilePayload, credentialRawMetadata)
  )
}
