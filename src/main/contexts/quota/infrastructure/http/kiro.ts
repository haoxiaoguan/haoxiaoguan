// Kiro live quota fetch. 对应 quota/infrastructure/quota/Rust模块.
//
// Region-routed getUsageLimits (endpoint derived from the profileArn region
// segment). On failure, refresh the token and retry once. provider_payload feeds
// the kiro credits parser.

import type { JsonValue } from '../../../account/domain/platform-account-profile'
import { Credential } from '../../../account/domain/credential'
import type { QuotaFetchResult } from '../../domain/capabilities'
import {
  credentialWithPayload,
  httpFetch,
  normalizeNonEmpty,
  parseJson,
  pickI64Http,
  pickStringHttp,
  providerError,
  successResult,
  timestampToDate,
} from './common'
import { getPathValue } from '../../domain/quota-state'

const REFRESH_ENDPOINT = 'https://prod.us-east-1.auth.desktop.kiro.dev/refreshToken'
const RUNTIME_DEFAULT_ENDPOINT = 'https://q.us-east-1.amazonaws.com'

export async function fetch(
  credential: Credential,
  profilePayload: JsonValue,
): Promise<QuotaFetchResult> {
  let accessToken = credential.token
  let refreshToken = credential.refreshToken
  let expiresAt = credential.expiresAt
  const profileArn = extractProfileArn(credential.rawMetadata, profilePayload)
  if (profileArn === undefined) {
    throw providerError('Kiro 缺少 profileArn，无法查询 runtime usage')
  }

  let usage: JsonValue | undefined
  try {
    usage = await fetchUsageLimits(accessToken, profileArn)
  } catch {
    const refresh = normalizeNonEmpty(refreshToken)
    if (refresh !== undefined) {
      try {
        const token = await refreshTokenRequest(refresh)
        const nextAccess = pickStringHttp(token, [
          ['accessToken'],
          ['access_token'],
          ['token'],
          ['idToken'],
          ['id_token'],
        ])
        if (nextAccess !== undefined) accessToken = nextAccess
        refreshToken =
          pickStringHttp(token, [['refreshToken'], ['refresh_token'], ['refreshTokenJwt']]) ??
          refreshToken
        const expTs = pickI64Http(token, [['expiresAt'], ['expires_at'], ['expiry'], ['expiration']])
        if (expTs !== undefined) {
          expiresAt = timestampToDate(expTs)
        } else {
          const expiresIn = pickI64Http(token, [['expiresIn'], ['expires_in']])
          if (expiresIn !== undefined) expiresAt = new Date(Date.now() + expiresIn * 1000)
        }
        usage = await fetchUsageLimits(accessToken, profileArn)
      } catch (e) {
        throw e
      }
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

async function fetchUsageLimits(accessToken: string, profileArn: string): Promise<JsonValue> {
  const endpoint = runtimeEndpointForRegion(parseProfileArnRegion(profileArn))
  const url = `${endpoint.replace(/\/+$/, '')}/getUsageLimits?origin=AI_EDITOR&profileArn=${encodeURIComponent(
    profileArn,
  )}&resourceType=AGENTIC_REQUEST&isEmailRequired=true`
  const response = await httpFetch(
    url,
    { method: 'GET', headers: { Authorization: `Bearer ${accessToken.trim()}` } },
    '请求 Kiro runtime usage 失败',
  )
  if (!response.ok) throw providerError(`Kiro runtime usage 返回异常: status=${response.status}`)
  return parseJson(response, '解析 Kiro runtime usage 响应失败')
}

async function refreshTokenRequest(refreshToken: string): Promise<JsonValue> {
  const response = await httpFetch(
    REFRESH_ENDPOINT,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    },
    '请求 Kiro refreshToken 失败',
  )
  if (!response.ok) throw providerError(`Kiro refreshToken 返回异常: status=${response.status}`)
  const value = await parseJson(response, '解析 Kiro refreshToken 响应失败')
  const data = getPathValue(value, ['data'])
  return data ?? value
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

function parseProfileArnRegion(profileArn: string): string | undefined {
  const segments = profileArn.split(':')
  const prefix = segments[0]?.trim()
  if (prefix === undefined || prefix.toLowerCase() !== 'arn') return undefined
  // segments: arn, partition, service, region, ...
  const region = segments[3]?.trim()
  return region !== undefined && region.length > 0 ? region : undefined
}

function runtimeEndpointForRegion(region: string | undefined): string {
  switch ((region ?? 'us-east-1').trim().toLowerCase()) {
    case 'us-east-1':
      return 'https://q.us-east-1.amazonaws.com'
    case 'eu-central-1':
      return 'https://q.eu-central-1.amazonaws.com'
    case 'us-gov-east-1':
      return 'https://q-fips.us-gov-east-1.amazonaws.com'
    case 'us-gov-west-1':
      return 'https://q-fips.us-gov-west-1.amazonaws.com'
    case 'us-iso-east-1':
      return 'https://q.us-iso-east-1.c2s.ic.gov'
    case 'us-isob-east-1':
      return 'https://q.us-isob-east-1.sc2s.sgov.gov'
    case 'us-isof-south-1':
      return 'https://q.us-isof-south-1.csp.hci.ic.gov'
    case 'us-isof-east-1':
      return 'https://q.us-isof-east-1.csp.hci.ic.gov'
    default:
      return RUNTIME_DEFAULT_ENDPOINT
  }
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
