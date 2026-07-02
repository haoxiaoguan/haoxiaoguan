// Codex live quota fetch.

import { randomUUID } from 'node:crypto'
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
const RESET_CREDITS_URL = 'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits'
const RESET_CREDITS_CONSUME_URL =
  'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume'
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

/** 主动重置额度结果：消耗一次 reset credit（对照 cockpit-tools consume_reset_credit）。 */
export interface CodexResetCreditResult {
  /** token 被刷新时返回新凭据，供上层持久化；未刷新则 undefined。 */
  updatedCredential?: Credential | undefined
}

/** 单张主动重置券（时间戳为 unix 秒）。 */
export interface CodexResetCredit {
  id?: string | undefined
  status?: string | undefined
  resetType?: string | undefined
  grantedAt?: number | undefined
  expiresAt?: number | undefined
  redeemedAt?: number | undefined
}

/** 主动重置券快照（GET rate-limit-reset-credits，含每张券的过期时间）。 */
export interface CodexResetCreditsSnapshot {
  availableCount: number | null
  nextExpiresAt: number | null
  credits: CodexResetCredit[]
  updatedCredential?: Credential | undefined
}

const CONSUMED_RESET_STATES = new Set(['redeemed', 'used', 'consumed', 'expired'])

function normalizeResetTimestamp(raw: JsonValue | undefined): number | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    // 券接口可能返回毫秒或秒；>1e12 视为毫秒。
    return raw > 1_000_000_000_000 ? Math.floor(raw / 1000) : Math.floor(raw)
  }
  if (typeof raw === 'string') {
    const n = Number(raw.trim())
    if (Number.isFinite(n) && /^\d+$/.test(raw.trim())) {
      return n > 1_000_000_000_000 ? Math.floor(n / 1000) : Math.floor(n)
    }
    const ms = Date.parse(raw.trim())
    if (!Number.isNaN(ms)) return Math.floor(ms / 1000)
  }
  return undefined
}

function isAvailableResetCredit(credit: CodexResetCredit): boolean {
  const status = (credit.status ?? '').toLowerCase()
  if (CONSUMED_RESET_STATES.has(status)) return false
  // 有过期时间且已过期 → 不可用。
  if (credit.expiresAt !== undefined && credit.expiresAt <= Math.floor(Date.now() / 1000)) {
    return false
  }
  return true
}

function parseResetCredit(value: JsonValue): CodexResetCredit {
  const id = pickStringHttp(value, [['id'], ['credit_id'], ['creditId']])
  const rawStatus = pickStringHttp(value, [['status'], ['state']])
  return {
    id,
    status: rawStatus?.toLowerCase(),
    resetType: pickStringHttp(value, [['type'], ['reset_type'], ['resetType']]),
    grantedAt: normalizeResetTimestamp(
      getPathValue(value, ['granted_at']) ?? getPathValue(value, ['created_at']) ?? getPathValue(value, ['grantedAt']),
    ),
    expiresAt: normalizeResetTimestamp(
      getPathValue(value, ['expires_at']) ?? getPathValue(value, ['expire_at']) ?? getPathValue(value, ['expiresAt']),
    ),
    redeemedAt: normalizeResetTimestamp(
      getPathValue(value, ['redeemed_at']) ??
        getPathValue(value, ['used_at']) ??
        getPathValue(value, ['consumed_at']) ??
        getPathValue(value, ['redeemedAt']),
    ),
  }
}

function parseResetCreditsSnapshot(payload: JsonValue): Omit<CodexResetCreditsSnapshot, 'updatedCredential'> {
  const rawCredits = getPathValue(payload, ['credits']) ?? getPathValue(payload, ['data', 'credits'])
  const credits = Array.isArray(rawCredits) ? rawCredits.map(parseResetCredit) : []

  const availableRaw =
    pickI64Http(payload, [
      ['available_count'],
      ['availableCount'],
      ['data', 'available_count'],
      ['data', 'availableCount'],
    ]) ?? credits.filter(isAvailableResetCredit).length
  const availableCount = availableRaw

  const nextExpiresAt =
    credits
      .filter(isAvailableResetCredit)
      .map((c) => c.expiresAt)
      .filter((t): t is number => typeof t === 'number')
      .sort((a, b) => a - b)[0] ?? null

  return { availableCount, credits, nextExpiresAt }
}

/**
 * 查询 Codex 主动重置券明细（GET rate-limit-reset-credits，含每张券的过期时间）。
 * 过期先刷 token；401 时刷新后重试一次。
 */
export async function fetchResetCredits(
  credential: Credential,
  profilePayload: JsonValue,
): Promise<CodexResetCreditsSnapshot> {
  let accessToken = credential.token
  let refreshToken = credential.refreshToken
  let expiresAt = credential.expiresAt
  let updated: Credential | undefined

  const refreshIfPossible = async (): Promise<boolean> => {
    const refresh = normalizeNonEmpty(refreshToken)
    if (refresh === undefined) return false
    const token = await refreshAccessToken(refresh)
    const nextAccess = pickStringHttp(token, [['access_token'], ['accessToken']])
    if (nextAccess === undefined) return false
    accessToken = nextAccess
    refreshToken = pickStringHttp(token, [['refresh_token'], ['refreshToken']]) ?? refreshToken
    const expiresIn = getPathValue(token, ['expires_in'])
    if (typeof expiresIn === 'number') expiresAt = new Date(Date.now() + expiresIn * 1000)
    updated = credentialWithPayload(credential, accessToken, refreshToken, expiresAt, profilePayload)
    return true
  }

  if (jwtNeedsRefresh(accessToken)) await refreshIfPossible()

  const accountId = chatgptAccountId(accessToken, credential.rawMetadata, profilePayload)
  let resp = await getResetCredits(accessToken, accountId)
  if (resp.status === 401 && (await refreshIfPossible())) {
    const retryAccountId = chatgptAccountId(accessToken, credential.rawMetadata, profilePayload)
    resp = await getResetCredits(accessToken, retryAccountId)
  }
  if (!resp.ok) {
    throw providerError(`Codex 主动重置券接口返回异常: status=${resp.status}`)
  }
  const payload = await parseJson(resp, '解析 Codex 主动重置券响应失败')
  return { ...parseResetCreditsSnapshot(payload), updatedCredential: updated }
}

async function getResetCredits(accessToken: string, accountId: string | undefined): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
    Referer: 'https://chatgpt.com/',
    'User-Agent': CHATGPT_WEB_USER_AGENT,
  }
  if (accountId !== undefined) headers['ChatGPT-Account-Id'] = accountId
  return httpFetch(RESET_CREDITS_URL, { method: 'GET', headers }, '请求 Codex 主动重置券失败')
}

/**
 * 消耗一次 Codex「主动重置额度」（POST rate-limit-reset-credits/consume）。
 * 过期先刷 token；接口 401 时刷新后重试一次。API Key 账号不支持。
 */
export async function consumeResetCredit(
  credential: Credential,
  profilePayload: JsonValue,
): Promise<CodexResetCreditResult> {
  let accessToken = credential.token
  let refreshToken = credential.refreshToken
  let expiresAt = credential.expiresAt
  let updated: Credential | undefined

  const refreshIfPossible = async (): Promise<boolean> => {
    const refresh = normalizeNonEmpty(refreshToken)
    if (refresh === undefined) return false
    const token = await refreshAccessToken(refresh)
    const nextAccess = pickStringHttp(token, [['access_token'], ['accessToken']])
    if (nextAccess === undefined) return false
    accessToken = nextAccess
    refreshToken = pickStringHttp(token, [['refresh_token'], ['refreshToken']]) ?? refreshToken
    const expiresIn = getPathValue(token, ['expires_in'])
    if (typeof expiresIn === 'number') expiresAt = new Date(Date.now() + expiresIn * 1000)
    updated = credentialWithPayload(credential, accessToken, refreshToken, expiresAt, profilePayload)
    return true
  }

  if (jwtNeedsRefresh(accessToken)) await refreshIfPossible()

  const accountId = chatgptAccountId(accessToken, credential.rawMetadata, profilePayload)
  const redeemRequestId = randomUUID()

  let status = await postConsume(accessToken, accountId, redeemRequestId)
  if (status === 401 && (await refreshIfPossible())) {
    const retryAccountId = chatgptAccountId(accessToken, credential.rawMetadata, profilePayload)
    status = await postConsume(accessToken, retryAccountId, redeemRequestId)
  }
  if (status < 200 || status >= 300) {
    throw providerError(`Codex 主动重置接口返回异常: status=${status}`)
  }
  return { updatedCredential: updated }
}

async function postConsume(
  accessToken: string,
  accountId: string | undefined,
  redeemRequestId: string,
): Promise<number> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Referer: 'https://chatgpt.com/',
    'User-Agent': CHATGPT_WEB_USER_AGENT,
  }
  if (accountId !== undefined) headers['ChatGPT-Account-Id'] = accountId
  const response = await httpFetch(
    RESET_CREDITS_CONSUME_URL,
    { method: 'POST', headers, body: JSON.stringify({ redeem_request_id: redeemRequestId }) },
    '请求 Codex 主动重置失败',
  )
  return response.status
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
  // 主动重置次数（rate_limit_reset_credits.available_count）：对齐 cockpit-tools
  // codex_quota.rs 的 ResetCreditsInfo，与限速窗口同在 wham/usage 响应里返回，无需额外请求。
  const resetCreditsAvailable = pickI64Http(usage, [
    ['rate_limit_reset_credits', 'available_count'],
    ['rateLimitResetCredits', 'availableCount'],
  ])
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
    reset_credits_available: resetCreditsAvailable ?? null,
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
