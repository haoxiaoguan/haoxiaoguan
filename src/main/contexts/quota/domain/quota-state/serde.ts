// AccountQuotaState <-> JSON (de)serialisation.
//
// The wire/persisted form 对应 serde output: camelCase keys,
// Dates as RFC3339 strings, optional fields omitted when undefined
// (serde skip_serializing_if = "Option::is_none"). Used by:
//  - the account_quota_state repository (quota_payload_json column),
//  - the IPC response mappers (AccountQuotaStateResponse).
// This is the single authoritative projection so persisted JSON round-trips
// exactly through the repository read path.

import type { JsonValue } from '../../../account/domain/platform-account-profile'
import {
  AccountQuotaState,
  type QuotaMetric,
  type QuotaMetricKind,
  type QuotaStatus,
  type QuotaUnit,
  type QuotaWindow,
} from './model'

export interface QuotaMetricJson {
  key: string
  label: string
  kind: QuotaMetricKind
  unit: QuotaUnit
  used?: number
  total?: number
  remaining?: number
  percentUsed?: number
  percentRemaining?: number
  displayValue?: string
  window?: QuotaWindow
  resetAt?: string
  status: QuotaStatus
}

export interface AccountQuotaStateJson {
  version: number
  status: QuotaStatus
  primaryMetricKey?: string
  metrics: QuotaMetricJson[]
  fetchedAt?: string
  error?: string
  providerPayload: JsonValue
}

export function quotaMetricToJson(metric: QuotaMetric): QuotaMetricJson {
  const out: QuotaMetricJson = {
    key: metric.key,
    label: metric.label,
    kind: metric.kind,
    unit: metric.unit,
    status: metric.status,
  }
  if (metric.used !== undefined) out.used = metric.used
  if (metric.total !== undefined) out.total = metric.total
  if (metric.remaining !== undefined) out.remaining = metric.remaining
  if (metric.percentUsed !== undefined) out.percentUsed = metric.percentUsed
  if (metric.percentRemaining !== undefined) out.percentRemaining = metric.percentRemaining
  if (metric.displayValue !== undefined) out.displayValue = metric.displayValue
  if (metric.window !== undefined) out.window = metric.window
  if (metric.resetAt !== undefined) out.resetAt = metric.resetAt.toISOString()
  return out
}

export function accountQuotaStateToJson(state: AccountQuotaState): AccountQuotaStateJson {
  const out: AccountQuotaStateJson = {
    version: state.version,
    status: state.status,
    metrics: state.metrics.map(quotaMetricToJson),
    providerPayload: state.providerPayload ?? {},
  }
  if (state.primaryMetricKey !== undefined) out.primaryMetricKey = state.primaryMetricKey
  if (state.fetchedAt !== undefined) out.fetchedAt = state.fetchedAt.toISOString()
  if (state.error !== undefined) out.error = state.error
  return out
}

function quotaMetricFromJson(json: QuotaMetricJson): QuotaMetric {
  return {
    key: json.key,
    label: json.label,
    kind: json.kind,
    unit: json.unit,
    used: json.used,
    total: json.total,
    remaining: json.remaining,
    percentUsed: json.percentUsed,
    percentRemaining: json.percentRemaining,
    displayValue: json.displayValue,
    window: json.window,
    resetAt: json.resetAt !== undefined ? new Date(json.resetAt) : undefined,
    status: json.status,
  }
}

export function accountQuotaStateFromJson(json: AccountQuotaStateJson): AccountQuotaState {
  return new AccountQuotaState({
    version: json.version,
    status: json.status,
    primaryMetricKey: json.primaryMetricKey,
    metrics: (json.metrics ?? []).map(quotaMetricFromJson),
    fetchedAt: json.fetchedAt !== undefined ? new Date(json.fetchedAt) : undefined,
    error: json.error,
    providerPayload: json.providerPayload ?? {},
  })
}
