// Cursor profile-payload parser.

import type { JsonValue } from '../../../account/domain/platform-account-profile'
import {
  formatPercent,
  genericStateFromProfile,
  percentUsageMetric,
  pickBoolAny,
  pickNumberAny,
  pickStringAny,
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
    // usage-summary 的计费周期结束时间即额度重置时间
    ['cursor_usage_raw', 'billingCycleEnd'],
    ['cursor_usage_raw', 'billing_cycle_end'],
    ['cursorUsageRaw', 'billingCycleEnd'],
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

  const onDemand = onDemandMetric(profilePayload, credentialRawMetadata)
  if (onDemand) metrics.push(onDemand)

  return (
    stateFromMetrics(metrics, profilePayload) ??
    genericStateFromProfile(profilePayload, credentialRawMetadata)
  )
}

/**
 * 按需使用（超额计费）指标。对齐 cockpit-tools 的口径：
 *  - limitType=team 时优先 teamUsage.onDemand（团队池）,否则 individualUsage.onDemand
 *    （兼容 spendLimitUsage 旧形态）；金额为美分,显示换算为美元。
 *  - 有固定上限(limit>0) → used/limit 百分比进度;
 *  - 无上限但 enabled=true 且非团队池 → Unlimited(仅展示已花费金额);
 *  - 其余(onDemand 字段存在但未启用) → 已禁用。
 *  - 响应里完全没有 onDemand 数据时返回 undefined(不显示该行)。
 */
function onDemandMetric(
  profilePayload: JsonValue,
  credentialRawMetadata: JsonValue | undefined,
): QuotaMetric | undefined {
  const limitType = pickStringAny(profilePayload, credentialRawMetadata, [
    ['cursor_usage_raw', 'limitType'],
    ['cursor_usage_raw', 'limit_type'],
    ['cursorUsageRaw', 'limitType'],
    ['cursor_usage_raw', 'spendLimitUsage', 'limitType'],
  ])?.toLowerCase()
  const isTeamLimit = limitType === 'team'

  const individualPaths = (field: string): string[][] => [
    ['cursor_usage_raw', 'individualUsage', 'onDemand', field],
    ['cursor_usage_raw', 'individual_usage', 'onDemand', field],
    ['cursorUsageRaw', 'individualUsage', 'onDemand', field],
    ['cursor_usage_raw', 'spendLimitUsage', field],
    ['cursor_usage_raw', 'spend_limit_usage', field],
  ]
  const teamPaths = (field: string): string[][] => [
    ['cursor_usage_raw', 'teamUsage', 'onDemand', field],
    ['cursor_usage_raw', 'team_usage', 'onDemand', field],
    ['cursorUsageRaw', 'teamUsage', 'onDemand', field],
  ]
  const pickCents = (fields: string[], team: boolean): number | undefined =>
    pickNumberAny(
      profilePayload,
      credentialRawMetadata,
      fields.flatMap((f) => (team ? [...teamPaths(f), ...individualPaths(f)] : individualPaths(f))),
    )

  const usedCents = pickCents(['used', 'totalSpend', 'total_spend', 'individualUsed', 'pooledUsed'], isTeamLimit)
  const limitCents = pickCents(
    ['limit', 'individualLimit', 'individual_limit', 'pooledLimit', 'pooled_limit'],
    isTeamLimit,
  )
  const enabled = pickBoolAny(profilePayload, credentialRawMetadata, [
    ['cursor_usage_raw', 'individualUsage', 'onDemand', 'enabled'],
    ['cursor_usage_raw', 'individual_usage', 'onDemand', 'enabled'],
    ['cursorUsageRaw', 'individualUsage', 'onDemand', 'enabled'],
  ])

  // 没有任何 onDemand 信号(老响应/未知形态):不显示该行。
  if (usedCents === undefined && limitCents === undefined && enabled === undefined) return undefined

  const toUsd = (cents: number): number => Math.round(cents) / 100
  const usedUsd = usedCents !== undefined ? toUsd(usedCents) : undefined

  if (limitCents !== undefined && limitCents > 0) {
    const metric = quotaUsageMetric('on_demand', '按需使用', usedUsd ?? 0, toUsd(limitCents), 'usd', undefined)
    if (metric) {
      if (metric.percentUsed !== undefined) metric.displayValue = formatPercent(metric.percentUsed)
      return metric
    }
  }

  if (enabled === true && !isTeamLimit) {
    return {
      key: 'on_demand',
      label: '按需使用',
      kind: 'usage',
      unit: 'usd',
      used: usedUsd,
      displayValue: 'Unlimited',
      status: 'ok',
    }
  }

  return {
    key: 'on_demand',
    label: '按需使用',
    kind: 'usage',
    unit: 'usd',
    displayValue: '已禁用',
    status: 'ok',
  }
}
