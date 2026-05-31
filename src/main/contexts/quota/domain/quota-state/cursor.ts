// Cursor profile-payload parser. 对应 quota_state/cursor.rs.

import type { JsonValue } from '../../../account/domain/platform-account-profile'
import {
  formatPercent,
  genericStateFromProfile,
  percentUsageMetric,
  pickNumberAny,
  pickTimestampAny,
  quotaUnitFromPayload,
  quotaUsageMetric,
  stateFromMetrics,
  type AccountQuotaState,
  type QuotaMetric,
} from './model'

export function stateFromProfile(
  profilePayload: JsonValue,
  credentialRawMetadata: JsonValue | undefined,
): AccountQuotaState | undefined {
  const resetAt = pickTimestampAny(profilePayload, credentialRawMetadata, [
    ['usage', 'totalUsage', 'resetAt'],
    ['usage', 'resetAt'],
    ['resetAt'],
    ['usageResetAt'],
  ])
  const unit = quotaUnitFromPayload(
    profilePayload,
    credentialRawMetadata,
    [['usage', 'totalUsage', 'unit'], ['totalUsage', 'unit'], ['usage', 'unit']],
    'percent',
  )

  const metrics: QuotaMetric[] = []
  const totalPercentUsed = pickNumberAny(profilePayload, credentialRawMetadata, [
    ['usage', 'totalUsage', 'percentUsed'],
    ['totalUsage', 'percentUsed'],
    ['usage', 'percentUsed'],
    ['cursor_usage_raw', 'individualUsage', 'plan', 'totalPercentUsed'],
    ['cursor_usage_raw', 'individualUsage', 'plan', 'total_percent_used'],
    ['cursor_usage_raw', 'planUsage', 'totalPercentUsed'],
    ['cursor_usage_raw', 'plan_usage', 'total_percent_used'],
    ['cursorUsageRaw', 'individualUsage', 'plan', 'totalPercentUsed'],
    ['cursorUsageRaw', 'planUsage', 'totalPercentUsed'],
  ])

  const percentMetric = percentUsageMetric('total_usage', 'Total Usage', totalPercentUsed)
  if (percentMetric) {
    percentMetric.resetAt = resetAt
    metrics.push(percentMetric)
  } else {
    const usageMetric = quotaUsageMetric(
      'total_usage',
      'Total Usage',
      pickNumberAny(profilePayload, credentialRawMetadata, [
        ['usage', 'totalUsage', 'used'],
        ['totalUsage', 'used'],
        ['usage', 'used'],
        ['cursor_usage_raw', 'individualUsage', 'plan', 'used'],
        ['cursor_usage_raw', 'individual_usage', 'plan', 'used'],
        ['cursor_usage_raw', 'planUsage', 'used'],
        ['cursor_usage_raw', 'plan_usage', 'used'],
        ['cursorUsageRaw', 'individualUsage', 'plan', 'used'],
        ['cursorUsageRaw', 'planUsage', 'used'],
      ]),
      pickNumberAny(profilePayload, credentialRawMetadata, [
        ['usage', 'totalUsage', 'total'],
        ['totalUsage', 'total'],
        ['usage', 'total'],
        ['cursor_usage_raw', 'individualUsage', 'plan', 'limit'],
        ['cursor_usage_raw', 'individual_usage', 'plan', 'limit'],
        ['cursor_usage_raw', 'planUsage', 'limit'],
        ['cursor_usage_raw', 'plan_usage', 'limit'],
        ['cursorUsageRaw', 'individualUsage', 'plan', 'limit'],
        ['cursorUsageRaw', 'planUsage', 'limit'],
      ]),
      unit,
      resetAt,
    )
    if (usageMetric) {
      if (usageMetric.percentUsed !== undefined) {
        usageMetric.displayValue = formatPercent(usageMetric.percentUsed)
      }
      metrics.push(usageMetric)
    }
  }

  const composer = percentUsageMetric(
    'auto_composer',
    'Auto + Composer',
    pickNumberAny(profilePayload, credentialRawMetadata, [
      ['usage', 'composer', 'percentUsed'],
      ['composer', 'percentUsed'],
      ['autoComposer', 'percentUsed'],
      ['usage', 'autoComposer', 'percentUsed'],
      ['cursor_usage_raw', 'individualUsage', 'plan', 'autoPercentUsed'],
      ['cursor_usage_raw', 'individualUsage', 'plan', 'auto_percent_used'],
      ['cursor_usage_raw', 'planUsage', 'autoPercentUsed'],
      ['cursorUsageRaw', 'individualUsage', 'plan', 'autoPercentUsed'],
    ]),
  )
  if (composer) metrics.push(composer)

  const apiMetric =
    percentUsageMetric(
      'api_usage',
      'API Usage',
      pickNumberAny(profilePayload, credentialRawMetadata, [
        ['usage', 'api', 'percentUsed'],
        ['api', 'percentUsed'],
        ['usage', 'apiUsage', 'percentUsed'],
        ['apiUsage', 'percentUsed'],
        ['cursor_usage_raw', 'individualUsage', 'plan', 'apiPercentUsed'],
        ['cursor_usage_raw', 'individualUsage', 'plan', 'api_percent_used'],
        ['cursor_usage_raw', 'planUsage', 'apiPercentUsed'],
        ['cursorUsageRaw', 'individualUsage', 'plan', 'apiPercentUsed'],
      ]),
    ) ??
    quotaUsageMetric(
      'api_usage',
      'API Usage',
      pickNumberAny(profilePayload, credentialRawMetadata, [
        ['api', 'usageUsd'],
        ['api', 'used'],
        ['apiUsage', 'used'],
      ]),
      pickNumberAny(profilePayload, credentialRawMetadata, [
        ['api', 'limitUsd'],
        ['api', 'total'],
        ['apiUsage', 'total'],
      ]),
      'usd',
      undefined,
    )
  if (apiMetric) metrics.push(apiMetric)

  return (
    stateFromMetrics(metrics, profilePayload) ??
    genericStateFromProfile(profilePayload, credentialRawMetadata)
  )
}
