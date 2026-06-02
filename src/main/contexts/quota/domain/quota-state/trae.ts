// Trae profile-payload parser.

import type { JsonValue } from '../../../account/domain/platform-account-profile'
import {
  genericStateFromProfile,
  getPathValue,
  parseTimestampValue,
  pickValueAny,
  quotaUsageMetric,
  stateFromMetrics,
  valueToF64,
  type AccountQuotaState,
} from './model'

interface TraeUsageSummary {
  label?: string
  used: number
  total: number
  resetAt?: Date
}

export function stateFromProfile(
  profilePayload: JsonValue,
  credentialRawMetadata: JsonValue | undefined,
): AccountQuotaState | undefined {
  const usageRoot = pickValueAny(profilePayload, credentialRawMetadata, [
    ['trae_usage_raw'],
    ['traeUsageRaw'],
  ])
  if (usageRoot === undefined) {
    return genericStateFromProfile(profilePayload, credentialRawMetadata)
  }
  const usage = extractTraeUsageSummary(usageRoot)
  if (usage === undefined) {
    return genericStateFromProfile(profilePayload, credentialRawMetadata)
  }
  const metric = quotaUsageMetric(
    'trae_quota',
    usage.label ?? 'Quota',
    usage.used,
    usage.total,
    'usd',
    usage.resetAt,
  )
  if (!metric) return genericStateFromProfile(profilePayload, credentialRawMetadata)
  return (
    stateFromMetrics([metric], profilePayload) ??
    genericStateFromProfile(profilePayload, credentialRawMetadata)
  )
}

function extractTraeUsageSummary(raw: JsonValue): TraeUsageSummary | undefined {
  const code = getPathValue(raw, ['code'])
  if (typeof code === 'number' && code !== 0) return undefined

  const packsValue =
    getPathValue(raw, ['user_entitlement_pack_list']) ??
    getPathValue(raw, ['userEntitlementPackList'])
  if (!Array.isArray(packsValue)) return undefined
  const selected = selectTraePack(packsValue)
  if (selected === undefined) return undefined

  const usage = getPathValue(selected, ['usage'])
  const entitlement =
    getPathValue(selected, ['entitlement_base_info']) ??
    getPathValue(selected, ['entitlementBaseInfo']) ??
    getPathValue(selected, ['entitlement'])
  const quota = entitlement !== undefined ? getPathValue(entitlement, ['quota']) : undefined

  const usedRaw =
    usage !== undefined
      ? getPathValue(usage, ['basic_usage_amount']) ??
        getPathValue(usage, ['basicUsageAmount']) ??
        getPathValue(usage, ['basic_usage'])
      : undefined
  const used = (usedRaw !== undefined ? valueToF64(usedRaw) : undefined) ?? 0

  const totalRaw =
    quota !== undefined
      ? getPathValue(quota, ['basic_usage_limit']) ??
        getPathValue(quota, ['basicUsageLimit']) ??
        getPathValue(quota, ['basic_quota'])
      : undefined
  const total = (totalRaw !== undefined ? valueToF64(totalRaw) : undefined) ?? 0

  let label: string | undefined
  if (entitlement !== undefined) {
    const labelRaw =
      getPathValue(entitlement, ['identity_str']) ??
      getPathValue(entitlement, ['identityStr']) ??
      getPathValue(entitlement, ['name'])
    if (typeof labelRaw === 'string') {
      const trimmed = labelRaw.trim()
      if (trimmed.length > 0) label = trimmed
    }
  }

  let resetAt: Date | undefined
  if (entitlement !== undefined) {
    const endRaw = getPathValue(entitlement, ['end_time']) ?? getPathValue(entitlement, ['endTime'])
    if (endRaw !== undefined) resetAt = parseTimestampValue(endRaw)
  }

  return { label, used, total, resetAt }
}

function selectTraePack(packs: JsonValue[]): JsonValue | undefined {
  const PROMO_CODE = 3
  for (const target of [6, 4, 1, 9, 8, 0]) {
    const pack = packs.find((p) => traeProductType(p) === target)
    if (pack !== undefined) return pack
  }
  return packs.find((p) => traeProductType(p) !== PROMO_CODE)
}

function traeProductType(pack: JsonValue): number | undefined {
  const base =
    getPathValue(pack, ['entitlement_base_info']) ?? getPathValue(pack, ['entitlementBaseInfo'])
  const raw =
    (base !== undefined
      ? getPathValue(base, ['product_type']) ?? getPathValue(base, ['productType'])
      : undefined) ??
    getPathValue(pack, ['product_type']) ??
    getPathValue(pack, ['productType'])
  if (raw === undefined) return undefined
  if (typeof raw === 'number' && Number.isInteger(raw)) return raw
  if (typeof raw === 'string') {
    const parsed = Number.parseInt(raw.trim(), 10)
    return Number.isNaN(parsed) ? undefined : parsed
  }
  return undefined
}
