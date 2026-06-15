// Codex live quota fetch.

import type { JsonValue } from '../../../account/domain/platform-account-profile'
import { Credential } from '../../../account/domain/credential'
import type { QuotaFetchResult } from '../../domain/capabilities'
import {
  credentialWithPayload,
  httpFetch,
  jwtClaimString,
  jwtNeedsRefresh,
  normalizeNonEmpty,
  parseJson,
  pickI64Http,
  pickStringHttp,
  providerError,
  successResult,
  timestampToDate,
} from './common'
import { getPathValue } from '../../domain/quota-state'

const USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'
const ACCOUNTS_CHECK_URL = 'https://chatgpt.com/backend-api/accounts/check/v4-2023-04-27'
const TOKEN_ENDPOINT = 'https://auth.openai.com/oauth/token'
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const CHATGPT_WEB_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36'

export async function fetch(
  credential: Credential,
  profilePayload: JsonValue,
): Promise<QuotaFetchResult> {
  let accessToken = credential.token
  let refreshToken = credential.refreshToken
  let expiresAt = credential.expiresAt
  let updated: Credential | undefined

  if (jwtNeedsRefresh(accessToken)) {
    const refresh = normalizeNonEmpty(refreshToken)
    if (refresh !== undefined) {
      const token = await refreshAccessToken(refresh)
      const nextAccess = pickStringHttp(token, [['access_token'], ['accessToken']])
      if (nextAccess !== undefined) accessToken = nextAccess
      refreshToken = pickStringHttp(token, [['refresh_token'], ['refreshToken']]) ?? refreshToken
      const expiresIn = getPathValue(token, ['expires_in'])
      if (typeof expiresIn === 'number') {
        expiresAt = new Date(Date.now() + expiresIn * 1000)
      }
    }
  }

  const usage = await fetchUsage(accessToken, credential.rawMetadata, profilePayload)
  const quota = parseQuota(usage)
  const planType = pickStringHttp(usage, [['plan_type'], ['planType']])

  // 会员有效期:accounts/check 的 entitlement.expires_at。best-effort,
  // 失败不影响额度刷新(保持上次值/有效期未知)。
  const accountId = chatgptAccountId(accessToken, credential.rawMetadata, profilePayload)
  let subscription: { activeUntil?: string | undefined; planType?: string | undefined } = {}
  try {
    subscription = await fetchSubscription(accessToken, accountId)
  } catch {
    subscription = {}
  }

  // 实时计划。务必同时覆盖 snake/camel 两套键——导入时写的是 camelCase planType/planTier，
  // 而旧版刷新只写 snake plan_type/planName，导致降级后 planType/plan_tier 残留旧值（display 侧
  // account-plan.ts 先读 camelCase planType → 显示陈旧「PRO 20x」+ 旧会员有效期）。
  const resolvedPlan = planType ?? subscription.planType ?? null
  const providerPayload = {
    ...(typeof profilePayload === 'object' && profilePayload !== null && !Array.isArray(profilePayload)
      ? profilePayload
      : {}),
    plan_type: resolvedPlan,
    planType: resolvedPlan,
    planName: resolvedPlan,
    planTier: resolvedPlan,
    quota,
    codex_usage_raw: usage,
    ...(subscription.activeUntil !== undefined
      ? { subscription_active_until: subscription.activeUntil }
      : {}),
  }

  if (
    accessToken !== credential.token ||
    refreshToken !== credential.refreshToken ||
    !sameDate(expiresAt, credential.expiresAt)
  ) {
    updated = credentialWithPayload(credential, accessToken, refreshToken, expiresAt, providerPayload)
  }

  return successResult('codex', credential, providerPayload, updated)
}

async function refreshAccessToken(refreshToken: string): Promise<JsonValue> {
  const response = await httpFetch(
    TOKEN_ENDPOINT,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    },
    'Codex Token 刷新请求失败',
  )
  if (!response.ok) throw providerError(`Codex Token 刷新失败: status=${response.status}`)
  return parseJson(response, '解析 Codex Token 响应失败')
}

async function fetchUsage(
  accessToken: string,
  rawMetadata: JsonValue | undefined,
  profilePayload: JsonValue,
): Promise<JsonValue> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
  }
  const accountId = chatgptAccountId(accessToken, rawMetadata, profilePayload)
  if (accountId !== undefined) headers['ChatGPT-Account-Id'] = accountId
  const response = await httpFetch(USAGE_URL, { method: 'GET', headers }, '请求 Codex 配额失败')
  if (!response.ok) throw providerError(`Codex 配额接口返回异常: status=${response.status}`)
  return parseJson(response, '解析 Codex 配额响应失败')
}

/**
 * accounts/check/v4 → 该账号的订阅信息(plan + 到期时间)。
 * 响应形如 { accounts: { <key>: { account: {...}, entitlement:
 * { subscription_plan, expires_at } } }, account_ordering: [...] }。
 * 优先匹配 account_id,其次 account_ordering 首位,最后第一个条目。
 */
async function fetchSubscription(
  accessToken: string,
  accountId: string | undefined,
): Promise<{ activeUntil?: string | undefined; planType?: string | undefined }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
    Referer: 'https://chatgpt.com/',
    'User-Agent': CHATGPT_WEB_USER_AGENT,
    'x-openai-target-path': '/backend-api/accounts/check/v4-2023-04-27',
    'x-openai-target-route': '/backend-api/accounts/check/v4-2023-04-27',
  }
  if (accountId !== undefined) headers['ChatGPT-Account-Id'] = accountId
  const offsetMin = -new Date().getTimezoneOffset()
  const response = await httpFetch(
    `${ACCOUNTS_CHECK_URL}?timezone_offset_min=${offsetMin}`,
    { method: 'GET', headers },
    '请求 Codex 订阅信息失败',
  )
  if (!response.ok) throw providerError(`Codex 订阅接口返回异常: status=${response.status}`)
  const payload = await parseJson(response, '解析 Codex 订阅响应失败')

  const accounts = getPathValue(payload, ['accounts'])
  if (accounts === undefined || typeof accounts !== 'object' || accounts === null || Array.isArray(accounts)) {
    return {}
  }
  const entries = Object.entries(accounts as Record<string, JsonValue>)
  if (entries.length === 0) return {}

  const recordAccountId = (node: JsonValue): string | undefined =>
    pickStringHttp(node, [
      ['account', 'account_id'],
      ['account', 'id'],
      ['account_id'],
      ['id'],
    ])
  const orderingFirst = (() => {
    const ordering = getPathValue(payload, ['account_ordering'])
    return Array.isArray(ordering) && typeof ordering[0] === 'string' ? ordering[0] : undefined
  })()

  const selected =
    (accountId !== undefined ? entries.find(([, node]) => recordAccountId(node) === accountId) : undefined) ??
    (orderingFirst !== undefined ? entries.find(([key]) => key === orderingFirst) : undefined) ??
    entries[0]

  const node = selected[1]
  return {
    activeUntil: pickStringHttp(node, [
      ['entitlement', 'expires_at'],
      ['account', 'expires_at'],
      ['expires_at'],
    ]),
    planType: pickStringHttp(node, [
      ['entitlement', 'subscription_plan'],
      ['account', 'plan_type'],
      ['plan_type'],
    ]),
  }
}

function chatgptAccountId(
  accessToken: string,
  rawMetadata: JsonValue | undefined,
  profilePayload: JsonValue,
): string | undefined {
  return (
    pickStringHttp(rawMetadata, [
      ['account_id'],
      ['accountId'],
      ['chatgpt_account_id'],
      ['chatgptAccountId'],
      ['tokens', 'account_id'],
    ]) ??
    pickStringHttp(profilePayload, [
      ['account_id'],
      ['accountId'],
      ['chatgpt_account_id'],
      ['chatgptAccountId'],
    ]) ??
    jwtClaimString(accessToken, 'https://api.openai.com/auth') ??
    jwtClaimString(accessToken, 'chatgpt_account_id')
  )
}

export function parseQuota(usage: JsonValue): JsonValue {
  const primary = getPathValue(usage, ['rate_limit', 'primary_window'])
  const secondary = getPathValue(usage, ['rate_limit', 'secondary_window'])
  return {
    hourly_percentage: remainingPercentage(primary),
    hourly_reset_time: resetTime(primary) ?? null,
    hourly_window_minutes: windowMinutes(primary) ?? null,
    // 用 != null：上游对「无该窗口」返回的是显式 null（如 free 账号 secondary_window:null），
    // 旧判断 `!== undefined` 把 null 误判为「存在」→ free 仍显示空的周额度。
    hourly_window_present: primary != null,
    weekly_percentage: remainingPercentage(secondary),
    weekly_reset_time: resetTime(secondary) ?? null,
    weekly_window_minutes: windowMinutes(secondary) ?? null,
    weekly_window_present: secondary != null,
    raw_data: usage,
  }
}

function remainingPercentage(window: JsonValue | undefined): number {
  const used = window != null ? pickI64Http(window, [['used_percent'], ['usedPercent']]) : undefined
  const clamped = Math.min(Math.max(used ?? 0, 0), 100)
  return 100 - clamped
}

function windowMinutes(window: JsonValue | undefined): number | undefined {
  const seconds =
    window != null ? pickI64Http(window, [['limit_window_seconds'], ['limitWindowSeconds']]) : undefined
  if (seconds === undefined || seconds <= 0) return undefined
  return Math.trunc((seconds + 59) / 60)
}

function resetTime(window: JsonValue | undefined): number | undefined {
  const resetAt = window != null ? pickI64Http(window, [['reset_at'], ['resetAt']]) : undefined
  if (resetAt !== undefined) return resetAt
  const seconds =
    window != null ? pickI64Http(window, [['reset_after_seconds'], ['resetAfterSeconds']]) : undefined
  if (seconds === undefined) return undefined
  return Math.trunc(timestampToDate(Math.trunc(Date.now() / 1000) + seconds).getTime() / 1000)
}

function sameDate(a: Date | undefined, b: Date | undefined): boolean {
  if (a === undefined && b === undefined) return true
  if (a === undefined || b === undefined) return false
  return a.getTime() === b.getTime()
}
