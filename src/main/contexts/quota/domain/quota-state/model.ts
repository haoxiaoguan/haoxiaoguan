// Quota-state normalisation model + shared helpers.
//
// Holds the parts NOT specific to a
// single platform. Per-platform parsers live in ./<platform>.ts and import the
// helpers exported here.
//
// Enum wire forms are snake_case; QuotaMetric/AccountQuotaState serialise camelCase
// at the IPC boundary (the handler/response layer maps Date → RFC3339 string and
// drops undefined optionals).

import type { JsonValue } from '../../../account/domain/platform-account-profile'
import type { ModelQuota, QuotaInfo } from '../quota'
import type {
  QuotaFetchResult,
  QuotaFreshness,
  QuotaOutcome,
} from '../capabilities'

export type QuotaStatus = 'ok' | 'warning' | 'exhausted' | 'unknown' | 'unsupported' | 'error'
export type QuotaUnit = 'credits' | 'requests' | 'tokens' | 'usd' | 'percent' | 'none'
export type QuotaMetricKind =
  | 'usage'
  | 'remaining'
  | 'balance'
  | 'rate_limit'
  | 'entitlement'
  | 'credential'
export type QuotaWindow = 'minute' | 'hour' | 'day' | 'month' | 'billing_cycle'

export interface QuotaMetric {
  key: string
  label: string
  kind: QuotaMetricKind
  unit: QuotaUnit
  used?: number | undefined
  total?: number | undefined
  remaining?: number | undefined
  percentUsed?: number | undefined
  percentRemaining?: number | undefined
  displayValue?: string | undefined
  window?: QuotaWindow | undefined
  resetAt?: Date | undefined
  status: QuotaStatus
}

export interface AccountQuotaSummary {
  accountId: string
  quotaStatus: QuotaStatus
  primaryMetricKey?: string | undefined
  primaryLabel?: string | undefined
  primaryValue?: string | undefined
  primaryPercent?: number | undefined
  primaryUnit: QuotaUnit
  resetAt?: Date | undefined
  fetchedAt?: Date | undefined
}

export interface AccountQuotaStateFields {
  version: number
  status: QuotaStatus
  primaryMetricKey?: string | undefined
  metrics: QuotaMetric[]
  fetchedAt?: Date | undefined
  error?: string | undefined
  providerPayload: JsonValue
}

/**
 * Normalised quota state aggregate. version is always 1. summary() derives the
 * column projection persisted in account_quota_state; sanitized() strips
 * sensitive keys from provider_payload recursively (mutates + returns this).
 */
export class AccountQuotaState {
  version: number
  status: QuotaStatus
  primaryMetricKey?: string | undefined
  metrics: QuotaMetric[]
  fetchedAt?: Date | undefined
  error?: string | undefined
  providerPayload: JsonValue

  constructor(fields: AccountQuotaStateFields) {
    this.version = fields.version
    this.status = fields.status
    this.primaryMetricKey = fields.primaryMetricKey
    this.metrics = fields.metrics
    this.fetchedAt = fields.fetchedAt
    this.error = fields.error
    this.providerPayload = fields.providerPayload
  }

  /** Strip sensitive keys from providerPayload, in place. */
  sanitized(): AccountQuotaState {
    this.providerPayload = sanitizeProviderPayload(this.providerPayload)
    return this
  }

  /** Column projection for account_quota_state. */
  summary(accountId: string): AccountQuotaSummary {
    const primary =
      (this.primaryMetricKey !== undefined
        ? this.metrics.find((m) => m.key === this.primaryMetricKey)
        : undefined) ?? this.metrics[0]

    return {
      accountId,
      quotaStatus: this.status,
      primaryMetricKey: primary?.key,
      primaryLabel: primary?.label,
      primaryValue:
        primary?.displayValue ??
        (primary?.percentUsed !== undefined ? `${primary.percentUsed.toFixed(0)}%` : undefined),
      primaryPercent: primary?.percentUsed ?? primary?.percentRemaining,
      primaryUnit: primary?.unit ?? 'none',
      resetAt: primary?.resetAt,
      fetchedAt: this.fetchedAt,
    }
  }

  /** Build from the legacy per-model QuotaInfo. */
  static fromLegacyQuota(quota: QuotaInfo): AccountQuotaState {
    const metrics = quota.models.map(metricFromModel)
    const primary = choosePrimaryMetric(metrics)
    return new AccountQuotaState({
      version: 1,
      status: statusFromMetrics(metrics),
      primaryMetricKey: primary?.key,
      metrics,
      fetchedAt: quota.fetchedAt,
      error: undefined,
      providerPayload: {},
    })
  }

  /** Build from a generic (non-platform-routed) fetch result. */
  static fromFetchResult(result: QuotaFetchResult): AccountQuotaState {
    if (result.outcome === 'success' || result.outcome === 'stale') {
      const quota: QuotaInfo = {
        accountId: NIL_UUID,
        models: result.models,
        fetchedAt: result.fetchedAt,
      } as QuotaInfo
      const state = AccountQuotaState.fromLegacyQuota(quota)
      if (result.freshness === 'stale') state.status = 'unknown'
      state.error = result.error
      if (!isJsonNull(result.providerPayload)) {
        state.providerPayload = sanitizeProviderPayload(result.providerPayload)
      }
      return state
    }

    return new AccountQuotaState({
      version: 1,
      status: statusFromOutcome(result.outcome),
      primaryMetricKey: undefined,
      metrics: [],
      fetchedAt: result.fetchedAt,
      error: result.error,
      providerPayload: sanitizeProviderPayload(result.providerPayload),
    })
  }
}

const NIL_UUID = '00000000-0000-0000-0000-000000000000'

function statusFromOutcome(outcome: QuotaOutcome): QuotaStatus {
  switch (outcome) {
    case 'unsupported':
      return 'unsupported'
    case 'failed':
      return 'error'
    default:
      return 'unknown'
  }
}

// ---------------------------------------------------------------------------
// Metric builders (exported for per-platform parsers).
// ---------------------------------------------------------------------------

export function metricFromModel(model: ModelQuota): QuotaMetric {
  const percentUsed = model.total === 0 ? undefined : (model.used * 100) / model.total
  const status: QuotaStatus =
    percentUsed === undefined
      ? 'unknown'
      : percentUsed >= 100
        ? 'exhausted'
        : percentUsed >= 90
          ? 'warning'
          : 'ok'

  return {
    key: model.modelName,
    label: model.modelName,
    kind: 'usage',
    unit: 'requests',
    used: model.used,
    total: model.total,
    remaining: Math.max(0, model.total - model.used),
    percentUsed,
    percentRemaining: percentUsed === undefined ? undefined : Math.max(0, 100 - percentUsed),
    displayValue: percentUsed === undefined ? undefined : `${percentUsed.toFixed(0)}%`,
    window: undefined,
    resetAt: model.resetAt,
    status,
  }
}

export function choosePrimaryMetric(metrics: QuotaMetric[]): QuotaMetric | undefined {
  return (
    metrics.find((m) => m.status === 'exhausted') ??
    metrics.find((m) => m.status === 'warning') ??
    metrics[0]
  )
}

export function statusFromMetrics(metrics: QuotaMetric[]): QuotaStatus {
  if (metrics.length === 0) return 'unknown'
  if (metrics.some((m) => m.status === 'exhausted')) return 'exhausted'
  if (metrics.some((m) => m.status === 'warning')) return 'warning'
  return 'ok'
}

export function stateFromMetrics(
  metrics: QuotaMetric[],
  profilePayload: JsonValue,
): AccountQuotaState | undefined {
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

export function genericStateFromProfile(
  profilePayload: JsonValue,
  credentialRawMetadata: JsonValue | undefined,
): AccountQuotaState | undefined {
  const metrics: QuotaMetric[] = []
  const metric = quotaUsageMetric(
    'usage',
    'Usage',
    pickNumberAny(profilePayload, credentialRawMetadata, [
      ['usage', 'used'],
      ['quota', 'used'],
      ['credits', 'used'],
      ['used'],
    ]),
    pickNumberAny(profilePayload, credentialRawMetadata, [
      ['usage', 'total'],
      ['quota', 'total'],
      ['credits', 'total'],
      ['total'],
    ]),
    quotaUnitFromPayload(
      profilePayload,
      credentialRawMetadata,
      [['usage', 'unit'], ['quota', 'unit'], ['credits', 'unit'], ['unit']],
      'requests',
    ),
    pickTimestampAny(profilePayload, credentialRawMetadata, [
      ['usage', 'resetAt'],
      ['quota', 'resetAt'],
      ['resetAt'],
    ]),
  )
  if (metric) metrics.push(metric)
  return stateFromMetrics(metrics, profilePayload)
}

export function quotaUsageMetric(
  key: string,
  label: string,
  used: number | undefined,
  total: number | undefined,
  unit: QuotaUnit,
  resetAt: Date | undefined,
): QuotaMetric | undefined {
  if (total === undefined) return undefined
  const usedValue = used ?? 0
  const remaining = Math.max(0, total - usedValue)
  const percentUsed = total > 0 ? (usedValue * 100) / total : undefined
  const status = statusFromPercentUsed(percentUsed)
  return {
    key,
    label,
    kind: 'usage',
    unit,
    used: usedValue,
    total,
    remaining,
    percentUsed,
    percentRemaining: percentUsed === undefined ? undefined : Math.max(0, 100 - percentUsed),
    displayValue: formatMetricPair(usedValue, total),
    window: 'billing_cycle',
    resetAt,
    status,
  }
}

export function percentUsageMetric(
  key: string,
  label: string,
  percentUsedInput: number | undefined,
): QuotaMetric | undefined {
  if (percentUsedInput === undefined) return undefined
  const percentUsed = clampPercent(percentUsedInput)
  const status: QuotaStatus =
    percentUsed >= 100 ? 'exhausted' : percentUsed >= 90 ? 'warning' : 'ok'
  return {
    key,
    label,
    kind: 'usage',
    unit: 'percent',
    used: undefined,
    total: undefined,
    remaining: undefined,
    percentUsed,
    percentRemaining: Math.max(0, 100 - percentUsed),
    displayValue: formatPercent(percentUsed),
    window: 'billing_cycle',
    resetAt: undefined,
    status,
  }
}

export function percentRemainingMetric(
  key: string,
  label: string,
  percentRemainingInput: number | undefined,
): QuotaMetric | undefined {
  if (percentRemainingInput === undefined) return undefined
  const percentRemaining = clampPercent(percentRemainingInput)
  const status: QuotaStatus =
    percentRemaining <= 0 ? 'exhausted' : percentRemaining <= 10 ? 'warning' : 'ok'
  return {
    key,
    label,
    kind: 'remaining',
    unit: 'percent',
    used: undefined,
    total: undefined,
    remaining: undefined,
    percentUsed: Math.max(0, 100 - percentRemaining),
    percentRemaining,
    displayValue: `${formatPercent(percentRemaining)} 剩余`,
    window: 'day',
    resetAt: undefined,
    status,
  }
}

export function percentRemainingMetricWithReset(
  key: string,
  label: string,
  percentRemaining: number | undefined,
  resetAt: Date | undefined,
  window: QuotaWindow | undefined,
): QuotaMetric | undefined {
  const metric = percentRemainingMetric(key, label, percentRemaining)
  if (!metric) return undefined
  metric.resetAt = resetAt
  metric.window = window
  return metric
}

export function entitlementMetric(
  key: string,
  label: string,
  displayValue: string | undefined,
): QuotaMetric {
  return {
    key,
    label,
    kind: 'entitlement',
    unit: 'none',
    used: undefined,
    total: undefined,
    remaining: undefined,
    percentUsed: 100,
    percentRemaining: undefined,
    displayValue,
    window: undefined,
    resetAt: undefined,
    status: 'ok',
  }
}

export function quotaUsageMetricWithRemaining(
  key: string,
  label: string,
  used: number | undefined,
  totalInput: number | undefined,
  remainingInput: number | undefined,
  unit: QuotaUnit,
  resetAt: Date | undefined,
): QuotaMetric | undefined {
  let total = totalInput
  if (total === undefined) {
    if (used !== undefined && remainingInput !== undefined) total = used + remainingInput
    else return undefined
  }
  let usedValue = used
  if (usedValue === undefined) {
    if (remainingInput !== undefined) usedValue = Math.max(0, total - remainingInput)
    else return undefined
  }
  const metric = quotaUsageMetric(key, label, usedValue, total, unit, resetAt)
  if (!metric) return undefined
  if (remainingInput !== undefined) {
    const remaining = Math.max(0, remainingInput)
    metric.remaining = remaining
    if (total > 0) {
      const percentRemaining = clamp((remaining * 100) / total, 0, 100)
      metric.percentRemaining = percentRemaining
      metric.percentUsed = Math.max(0, 100 - percentRemaining)
      metric.status =
        percentRemaining <= 0 ? 'exhausted' : percentRemaining <= 10 ? 'warning' : 'ok'
    }
  }
  return metric
}

export function quotaBalanceMetric(
  key: string,
  label: string,
  value: number | undefined,
  unit: QuotaUnit,
): QuotaMetric | undefined {
  if (value === undefined) return undefined
  return {
    key,
    label,
    kind: 'balance',
    unit,
    used: value,
    total: undefined,
    remaining: undefined,
    percentUsed: undefined,
    percentRemaining: undefined,
    displayValue: formatCompactNumber(value),
    window: undefined,
    resetAt: undefined,
    status: 'ok',
  }
}

function statusFromPercentUsed(percentUsed: number | undefined): QuotaStatus {
  if (percentUsed === undefined) return 'unknown'
  if (percentUsed >= 100) return 'exhausted'
  if (percentUsed >= 90) return 'warning'
  return 'ok'
}

// ---------------------------------------------------------------------------
// Number / formatting helpers.
// ---------------------------------------------------------------------------

export function clampPercent(value: number): number {
  return clamp(value, 0, 100)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function isIntegerish(value: number): boolean {
  return Math.abs(value - Math.trunc(value)) < Number.EPSILON
}

export function formatPercent(value: number): string {
  return isIntegerish(value) ? `${value.toFixed(0)}%` : `${value.toFixed(1)}%`
}

function formatMetricPair(used: number, total: number): string {
  return `${formatCompactNumber(used)} / ${formatCompactNumber(total)}`
}

function formatCompactNumber(value: number): string {
  return isIntegerish(value) ? value.toFixed(0) : value.toFixed(2)
}

// ---------------------------------------------------------------------------
// JSON path pickers (object-key-first traversal).
// ---------------------------------------------------------------------------

function isPlainObject(value: JsonValue | undefined): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isJsonNull(value: JsonValue): boolean {
  return value === null || value === undefined
}

export function getPathValue(root: JsonValue, path: readonly string[]): JsonValue | undefined {
  let current: JsonValue = root
  for (const key of path) {
    if (isPlainObject(current) && key in current) {
      current = current[key]
      continue
    }
    const index = Number.parseInt(key, 10)
    if (Number.isInteger(index) && index >= 0 && Array.isArray(current) && index < current.length) {
      current = current[index]
      continue
    }
    return undefined
  }
  return current
}

export function valueToF64(value: JsonValue): number | undefined {
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.length === 0) return undefined
    const num = Number(trimmed)
    return Number.isNaN(num) ? undefined : num
  }
  return undefined
}

export function pickNumber(
  root: JsonValue | undefined,
  paths: readonly (readonly string[])[],
): number | undefined {
  if (root === undefined) return undefined
  for (const path of paths) {
    const value = getPathValue(root, path)
    if (value === undefined) continue
    const num = valueToF64(value)
    if (num !== undefined && Number.isFinite(num)) return num
  }
  return undefined
}

export function pickNumberAny(
  profilePayload: JsonValue,
  credentialRawMetadata: JsonValue | undefined,
  paths: readonly (readonly string[])[],
): number | undefined {
  return pickNumber(profilePayload, paths) ?? pickNumber(credentialRawMetadata, paths)
}

export function pickBool(
  root: JsonValue | undefined,
  paths: readonly (readonly string[])[],
): boolean | undefined {
  if (root === undefined) return undefined
  for (const path of paths) {
    const value = getPathValue(root, path)
    if (value === undefined) continue
    if (typeof value === 'boolean') return value
    if (typeof value === 'string') {
      switch (value.trim().toLowerCase()) {
        case 'true':
        case '1':
        case 'yes':
          return true
        case 'false':
        case '0':
        case 'no':
          return false
        default:
          break
      }
    }
  }
  return undefined
}

export function pickBoolAny(
  profilePayload: JsonValue,
  credentialRawMetadata: JsonValue | undefined,
  paths: readonly (readonly string[])[],
): boolean | undefined {
  const fromProfile = pickBool(profilePayload, paths)
  return fromProfile !== undefined ? fromProfile : pickBool(credentialRawMetadata, paths)
}

export function pickValue(
  root: JsonValue | undefined,
  paths: readonly (readonly string[])[],
): JsonValue | undefined {
  if (root === undefined) return undefined
  for (const path of paths) {
    const value = getPathValue(root, path)
    if (value !== undefined) return value
  }
  return undefined
}

export function pickValueAny(
  profilePayload: JsonValue,
  credentialRawMetadata: JsonValue | undefined,
  paths: readonly (readonly string[])[],
): JsonValue | undefined {
  return pickValue(profilePayload, paths) ?? pickValue(credentialRawMetadata, paths)
}

export function pickString(
  root: JsonValue | undefined,
  paths: readonly (readonly string[])[],
): string | undefined {
  if (root === undefined) return undefined
  for (const path of paths) {
    const value = getPathValue(root, path)
    if (value === undefined) continue
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed.length > 0) return trimmed
    }
    if (typeof value === 'number' && Number.isInteger(value)) {
      return String(value)
    }
  }
  return undefined
}

export function pickStringAny(
  profilePayload: JsonValue,
  credentialRawMetadata: JsonValue | undefined,
  paths: readonly (readonly string[])[],
): string | undefined {
  return pickString(profilePayload, paths) ?? pickString(credentialRawMetadata, paths)
}

export function parseTimestampValue(value: JsonValue): Date | undefined {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return timestampToDate(value)
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    const ms = Date.parse(trimmed)
    if (!Number.isNaN(ms)) return new Date(ms)
    const asInt = Number.parseInt(trimmed, 10)
    if (!Number.isNaN(asInt) && String(asInt) === trimmed) {
      return timestampToDate(asInt)
    }
  }
  return undefined
}

function timestampToDate(seconds: number): Date | undefined {
  const normalized = seconds > 10_000_000_000 ? Math.trunc(seconds / 1000) : seconds
  const date = new Date(normalized * 1000)
  return Number.isNaN(date.getTime()) ? undefined : date
}

export function pickTimestamp(
  root: JsonValue | undefined,
  paths: readonly (readonly string[])[],
): Date | undefined {
  if (root === undefined) return undefined
  for (const path of paths) {
    const value = getPathValue(root, path)
    if (value === undefined) continue
    const ts = parseTimestampValue(value)
    if (ts !== undefined) return ts
  }
  return undefined
}

export function pickTimestampAny(
  profilePayload: JsonValue,
  credentialRawMetadata: JsonValue | undefined,
  paths: readonly (readonly string[])[],
): Date | undefined {
  return pickTimestamp(profilePayload, paths) ?? pickTimestamp(credentialRawMetadata, paths)
}

export function quotaUnitFromPayload(
  profilePayload: JsonValue,
  credentialRawMetadata: JsonValue | undefined,
  paths: readonly (readonly string[])[],
  fallback: QuotaUnit,
): QuotaUnit {
  const raw = (pickStringAny(profilePayload, credentialRawMetadata, paths) ?? '')
    .trim()
    .toLowerCase()
  switch (raw) {
    case 'usd':
    case 'dollar':
    case 'dollars':
    case '$':
      return 'usd'
    case 'percent':
    case 'percentage':
    case '%':
      return 'percent'
    case 'credit':
    case 'credits':
      return 'credits'
    case 'request':
    case 'requests':
      return 'requests'
    case 'token':
    case 'tokens':
      return 'tokens'
    default:
      return fallback
  }
}

// ---------------------------------------------------------------------------
// provider_payload sanitisation (recursive sensitive-key strip).
// ---------------------------------------------------------------------------

const SENSITIVE_KEYS = new Set<string>([
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'authorization',
  'cookie',
  'password',
  'apikey',
  'sessionkey',
  'sessionsecret',
  'secret',
  'codeverifier',
  'oauthstate',
  'state',
])

function isSensitiveKey(key: string): boolean {
  const normalized = key.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
  return SENSITIVE_KEYS.has(normalized)
}

export function sanitizeProviderPayload(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(sanitizeProviderPayload)
  }
  if (isPlainObject(value)) {
    const sanitized: { [key: string]: JsonValue } = {}
    for (const [key, inner] of Object.entries(value)) {
      if (isSensitiveKey(key)) continue
      sanitized[key] = sanitizeProviderPayload(inner)
    }
    return sanitized
  }
  return value
}
