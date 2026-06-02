// Cursor live quota fetch.
//
// Token refresh (if JWT near-expiry) → GetUserMeta + stripe profile + usage
// summary (cookie auth via WorkOS user_id from the JWT sub claim). Merges all
// raw responses into provider_payload for the cursor parser.

import type { JsonValue } from '../../../account/domain/platform-account-profile'
import type { Credential } from '../../../account/domain/credential'
import type { QuotaFetchResult } from '../../domain/capabilities'
import {
  credentialWithPayload,
  httpFetch,
  jwtNeedsRefresh,
  jwtPayload,
  mergePayload,
  normalizeNonEmpty,
  parseJson,
  pickStringHttp,
  providerError,
  successResult,
} from './common'
import { getPathValue } from '../../domain/quota-state'

const USAGE_SUMMARY_URL = 'https://cursor.com/api/usage-summary'
const USER_META_URL = 'https://api2.cursor.sh/aiserver.v1.AuthService/GetUserMeta'
const FULL_STRIPE_PROFILE_URL = 'https://api2.cursor.sh/auth/full_stripe_profile'
const STRIPE_PROFILE_URL = 'https://api2.cursor.sh/auth/stripe_profile'
const OAUTH_TOKEN_URL = 'https://api2.cursor.sh/oauth/token'
const CLIENT_ID = 'KbZUR41cY7W6zRSdpSUJ7I7mLYBKOCmB'

export async function fetch(
  credential: Credential,
  profilePayload: JsonValue,
): Promise<QuotaFetchResult> {
  let accessToken = credential.token
  let refreshToken = credential.refreshToken
  let updated: Credential | undefined

  if (jwtNeedsRefresh(accessToken)) {
    const refresh = normalizeNonEmpty(refreshToken)
    if (refresh !== undefined) {
      try {
        const token = await refreshAccessToken(refresh)
        const nextAccess = pickStringHttp(token, [['accessToken'], ['access_token']])
        if (nextAccess !== undefined) {
          accessToken = nextAccess
          refreshToken = pickStringHttp(token, [['refreshToken'], ['refresh_token']]) ?? refreshToken
        }
      } catch {
        // refresh failures are non-fatal here
      }
    }
  }

  let userMeta: JsonValue | undefined
  try {
    userMeta = await postJson(USER_META_URL, accessToken, {})
  } catch {
    userMeta = undefined
  }
  let stripeProfile: JsonValue | undefined
  try {
    stripeProfile = await fetchStripeProfile(accessToken)
  } catch {
    stripeProfile = undefined
  }
  const usage = await fetchUsageSummary(accessToken)

  const membership =
    (typeof getPathValue(usage, ['membershipType']) === 'string'
      ? normalizeNonEmpty(getPathValue(usage, ['membershipType']) as string)
      : undefined) ??
    (stripeProfile !== undefined
      ? pickStringHttp(stripeProfile, [['membershipType'], ['individualMembershipType']])
      : undefined)
  const email =
    (userMeta !== undefined ? pickStringHttp(userMeta, [['email']]) : undefined) ??
    pickStringHttp(profilePayload, [['email']])

  const providerPayload = mergePayload(profilePayload, {
    email: email ?? null,
    membershipType: membership ?? null,
    planName: membership ?? null,
    cursor_user_meta_raw: userMeta ?? null,
    cursor_stripe_profile_raw: stripeProfile ?? null,
    cursor_usage_raw: usage,
  })

  if (accessToken !== credential.token || refreshToken !== credential.refreshToken) {
    updated = credentialWithPayload(
      credential,
      accessToken,
      refreshToken,
      credential.expiresAt,
      providerPayload,
    )
  }

  return successResult('cursor', credential, providerPayload, updated)
}

async function refreshAccessToken(refreshToken: string): Promise<JsonValue> {
  const response = await httpFetch(
    OAUTH_TOKEN_URL,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        client_id: CLIENT_ID,
        refresh_token: refreshToken,
      }),
    },
    '请求 Cursor token 刷新接口失败',
  )
  if (!response.ok) {
    throw providerError(`Cursor token 刷新失败: status=${response.status}`)
  }
  return parseJson(response, '解析 Cursor token 刷新响应失败')
}

async function postJson(url: string, accessToken: string, body: JsonValue): Promise<JsonValue> {
  const response = await httpFetch(
    url,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
    '请求 Cursor 接口失败',
  )
  if (!response.ok) throw providerError(`Cursor 接口返回异常: status=${response.status}`)
  return parseJson(response, '解析 Cursor 响应失败')
}

async function fetchStripeProfile(accessToken: string): Promise<JsonValue | undefined> {
  for (const url of [FULL_STRIPE_PROFILE_URL, STRIPE_PROFILE_URL]) {
    const response = await httpFetch(
      url,
      { method: 'GET', headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } },
      '请求 Cursor stripe profile 失败',
    )
    if (response.ok) return parseJson(response, '解析 Cursor stripe profile 失败')
  }
  return undefined
}

async function fetchUsageSummary(accessToken: string): Promise<JsonValue> {
  const cookie = buildSessionCookie(accessToken)
  if (cookie === undefined) {
    throw providerError('无法从 Cursor accessToken 解析 WorkOS 用户 ID')
  }
  const response = await httpFetch(
    USAGE_SUMMARY_URL,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Cookie: cookie,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      },
    },
    '请求 Cursor usage API 失败',
  )
  if (!response.ok) throw providerError(`Cursor usage API 返回异常: status=${response.status}`)
  return parseJson(response, '解析 Cursor usage JSON 失败')
}

function buildSessionCookie(accessToken: string): string | undefined {
  const payload = jwtPayload(accessToken)
  if (payload === undefined) return undefined
  const sub = getPathValue(payload, ['sub'])
  if (typeof sub !== 'string') return undefined
  const parts = sub.split('|')
  const userId = parts[parts.length - 1] ?? sub
  if (!userId.startsWith('user_')) return undefined
  return `WorkosCursorSessionToken=${userId}%3A%3A${accessToken}`
}
