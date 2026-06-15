// Kiro live quota fetch.
//
// Region-routed getUsageLimits (endpoint derived from the profilePayload region
// or the profileArn region segment). On failure, refresh the token and retry
// once — IdC (Enterprise) refreshes against AWS SSO OIDC, Social against the
// Kiro desktop auth service. provider_payload feeds the kiro credits parser.
//
// Transport (endpoints, headers, IdC/Social refresh split) lives in the shared
// platform client so the import-time identity enrichment reuses it verbatim.
// Endpoints overridable via HAOXIAOGUAN_KIRO_RUNTIME_ENDPOINT / _AUTH_ENDPOINT.

import type { JsonValue } from '../../../account/domain/platform-account-profile'
import { Credential } from '../../../account/domain/credential'
import type { QuotaFetchResult } from '../../domain/capabilities'
import {
  credentialWithPayload,
  normalizeNonEmpty,
  pickI64Http,
  pickStringHttp,
  providerError,
  successResult,
} from './common'
import { getPathValue } from '../../domain/quota-state'
import {
  type KiroAuthMethod,
  defaultProfileArnFor,
  fetchKiroUsageLimits,
  normalizeRegion,
  parseRegionFromArn,
  refreshKiroToken,
  resolveKiroAuthMethod,
} from '../../../../platform/net/kiro/kiro-identity-client'

export async function fetch(
  credential: Credential,
  profilePayload: JsonValue,
): Promise<QuotaFetchResult> {
  let accessToken = credential.token
  let refreshToken = credential.refreshToken
  let expiresAt = credential.expiresAt
  const authMethod = resolveKiroAuthMethod(credential.rawMetadata)
  // profileArn is optional: social / device-login accounts carry none. Fall back
  // to the canonical per-auth-method default so we never reject the refresh and
  // the persisted payload always has a usable ARN.
  const profileArn =
    extractProfileArn(credential.rawMetadata, profilePayload) ?? defaultProfileArnFor(authMethod)
  // Region precedence: explicit profilePayload/rawMetadata region (set at import
  // for Enterprise IdC accounts) > the profileArn segment > us-east-1.
  const region = resolveRegion(credential.rawMetadata, profilePayload, profileArn)

  let usage: JsonValue | undefined
  try {
    usage = (await fetchKiroUsageLimits({ accessToken, authMethod, region, profileArn })) as JsonValue
  } catch {
    const refresh = normalizeNonEmpty(refreshToken)
    if (refresh !== undefined && authMethod !== 'api_key') {
      const token = await refreshKiroCredential(credential.rawMetadata, authMethod, region, refresh)
      accessToken = token.accessToken
      refreshToken = token.refreshToken ?? refreshToken
      expiresAt = token.expiresAt ?? expiresAt
      usage = (await fetchKiroUsageLimits({ accessToken, authMethod, region, profileArn })) as JsonValue
    }
  }
  if (usage === undefined) {
    throw providerError('Kiro runtime usage 获取失败')
  }
  const usageValue = usage

  const providerPayload = {
    ...(isObject(profilePayload) ? profilePayload : {}),
    email: pickStringHttp(usageValue, [['userInfo', 'email'], ['email']]) ?? null,
    user_id:
      pickStringHttp(usageValue, [
        ['userInfo', 'userId'],
        ['userId'],
        ['user_id'],
        ['sub'],
      ]) ?? null,
    login_provider:
      pickStringHttp(usageValue, [
        ['userInfo', 'provider', 'label'],
        ['userInfo', 'provider', 'name'],
        ['provider', 'label'],
        ['provider', 'name'],
      ]) ?? null,
    profileArn,
    planName: usagePlanName(usageValue) ?? null,
    planTier: usagePlanTier(usageValue) ?? null,
    creditsTotal: usageCreditsTotal(usageValue) ?? null,
    creditsUsed: usageCreditsUsed(usageValue) ?? null,
    bonusTotal: usageBonusTotal(usageValue) ?? null,
    bonusUsed: usageBonusUsed(usageValue) ?? null,
    // Overage: Kiro lets paid plans spend past the base allotment at a per-credit
    // rate, up to overageCap. overageEnabled gates whether to surface this as a
    // second metric (see quota-state/kiro.ts). overageCap is the spend ceiling,
    // NOT the plan's included credits (that's creditsTotal/usageLimit).
    overageEnabled: usageOverageEnabled(usageValue),
    overageCap: usageOverageCap(usageValue) ?? null,
    overageUsed: usageOverageUsed(usageValue) ?? null,
    usageResetAt: usageResetAt(usageValue) ?? null,
    kiro_usage_raw: usageValue,
  }

  let updated: Credential | undefined
  if (
    accessToken !== credential.token ||
    refreshToken !== credential.refreshToken ||
    !sameDate(expiresAt, credential.expiresAt)
  ) {
    updated = credentialWithPayload(credential, accessToken, refreshToken, expiresAt, providerPayload)
  }

  return successResult('kiro', credential, providerPayload, updated)
}

// Refresh via the shared client, branching IdC (needs clientId/clientSecret from
// the encrypted rawMetadata) vs Social. invalid_grant surfaces as a permanent
// error from the shared client — caller lets it propagate (no silent retry).
async function refreshKiroCredential(
  rawMetadata: JsonValue | undefined,
  authMethod: KiroAuthMethod,
  region: string,
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken?: string | undefined; expiresAt?: Date | undefined }> {
  if (authMethod === 'idc') {
    const clientId = pickStringHttp(rawMetadata, [['client_id'], ['clientId']])
    const clientSecret = pickStringHttp(rawMetadata, [['client_secret'], ['clientSecret']])
    if (clientId === undefined || clientSecret === undefined) {
      throw providerError('Kiro 企业号刷新缺少 clientId/clientSecret')
    }
    return refreshKiroToken({ kind: 'idc', clientId, clientSecret, refreshToken, region })
  }
  return refreshKiroToken({ kind: 'social', refreshToken, region })
}

function extractProfileArn(
  rawMetadata: JsonValue | undefined,
  profilePayload: JsonValue,
): string | undefined {
  return (
    pickStringHttp(profilePayload, [
      ['profileArn'],
      ['profile_arn'],
      ['kiro_profile_raw', 'arn'],
      ['profile', 'arn'],
    ]) ??
    pickStringHttp(rawMetadata, [
      ['profileArn'],
      ['profile_arn'],
      ['arn'],
      ['kiro_profile_raw', 'arn'],
    ])
  )
}

// Region used to route both the runtime and auth endpoints. Explicit region on
// the credential/profile (pinned at import for Enterprise IdC accounts) wins,
// then the profileArn segment, then the default.
function resolveRegion(
  rawMetadata: JsonValue | undefined,
  profilePayload: JsonValue,
  profileArn: string | undefined,
): string {
  const explicit =
    pickStringHttp(profilePayload, [['region']]) ??
    pickStringHttp(rawMetadata, [['region'], ['ssoRegion'], ['sso_region']])
  return normalizeRegion(explicit ?? parseRegionFromArn(profileArn))
}

function usagePlanName(usage: JsonValue): string | undefined {
  return pickStringHttp(usage, [['usageBreakdowns', 'planName'], ['planName'], ['plan', 'name']])
}

function usagePlanTier(usage: JsonValue): string | undefined {
  return pickStringHttp(usage, [['usageBreakdowns', 'tier'], ['tier'], ['plan', 'tier']])
}

function usageCreditsTotal(usage: JsonValue): number | undefined {
  return pickI64Http(usage, [
    ['usageBreakdowns', 'plan', 'totalCredits'],
    ['usageBreakdowns', 'covered', 'total'],
    ['usageBreakdownList', '0', 'usageLimitWithPrecision'],
    ['usageBreakdownList', '0', 'usageLimit'],
  ])
}

function usageCreditsUsed(usage: JsonValue): number | undefined {
  return pickI64Http(usage, [
    ['usageBreakdowns', 'plan', 'usedCredits'],
    ['usageBreakdowns', 'covered', 'used'],
    ['usageBreakdownList', '0', 'currentUsageWithPrecision'],
    ['usageBreakdownList', '0', 'currentUsage'],
  ])
}

function usageBonusTotal(usage: JsonValue): number | undefined {
  return pickI64Http(usage, [
    ['usageBreakdowns', 'bonus', 'total'],
    ['usageBreakdownList', '0', 'freeTrialInfo', 'usageLimit'],
  ])
}

function usageBonusUsed(usage: JsonValue): number | undefined {
  return pickI64Http(usage, [
    ['usageBreakdowns', 'bonus', 'used'],
    ['usageBreakdownList', '0', 'freeTrialInfo', 'currentUsage'],
  ])
}

// Overage spend ceiling (e.g. 10000 for a Pro+ with overage). Distinct from the
// plan's included credits (usageLimit). overageCapWithPrecision is the float form.
function usageOverageCap(usage: JsonValue): number | undefined {
  return pickI64Http(usage, [
    ['usageBreakdownList', '0', 'overageCap'],
    ['usageBreakdownList', '0', 'overageCapWithPrecision'],
    ['overageConfiguration', 'overageLimit'],
  ])
}

function usageOverageUsed(usage: JsonValue): number | undefined {
  return pickI64Http(usage, [
    ['usageBreakdownList', '0', 'currentOverages'],
    ['usageBreakdownList', '0', 'currentOveragesWithPrecision'],
  ])
}

// overageConfiguration.overageStatus == 'ENABLED' → the account can spend past
// the base allotment. Also honour a boolean overageEnabled if a future API uses it.
function usageOverageEnabled(usage: JsonValue): boolean {
  const status = pickStringHttp(usage, [
    ['overageConfiguration', 'overageStatus'],
    ['overageStatus'],
  ])
  return status !== undefined && status.trim().toUpperCase() === 'ENABLED'
}

function usageResetAt(usage: JsonValue): number | undefined {
  const breakdownReset = getPathValue(usage, ['usageBreakdowns', 'resetAt'])
  if (typeof breakdownReset === 'number') return breakdownReset
  return pickI64Http(usage, [['resetAt'], ['reset_at'], ['usageResetAt']])
}

function isObject(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sameDate(a: Date | undefined, b: Date | undefined): boolean {
  if (a === undefined && b === undefined) return true
  if (a === undefined || b === undefined) return false
  return a.getTime() === b.getTime()
}
