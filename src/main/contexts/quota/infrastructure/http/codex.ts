// Codex live quota fetch. 对应 quota/infrastructure/quota/codex.rs.

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
const TOKEN_ENDPOINT = 'https://auth.openai.com/oauth/token'
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'

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
  const providerPayload = {
    ...(typeof profilePayload === 'object' && profilePayload !== null && !Array.isArray(profilePayload)
      ? profilePayload
      : {}),
    plan_type: planType ?? null,
    planName: planType ?? null,
    quota,
    codex_usage_raw: usage,
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

function parseQuota(usage: JsonValue): JsonValue {
  const primary = getPathValue(usage, ['rate_limit', 'primary_window'])
  const secondary = getPathValue(usage, ['rate_limit', 'secondary_window'])
  return {
    hourly_percentage: remainingPercentage(primary),
    hourly_reset_time: resetTime(primary) ?? null,
    hourly_window_minutes: windowMinutes(primary) ?? null,
    hourly_window_present: primary !== undefined,
    weekly_percentage: remainingPercentage(secondary),
    weekly_reset_time: resetTime(secondary) ?? null,
    weekly_window_minutes: windowMinutes(secondary) ?? null,
    weekly_window_present: secondary !== undefined,
    raw_data: usage,
  }
}

function remainingPercentage(window: JsonValue | undefined): number {
  const used = window !== undefined ? pickI64Http(window, [['used_percent'], ['usedPercent']]) : undefined
  const clamped = Math.min(Math.max(used ?? 0, 0), 100)
  return 100 - clamped
}

function windowMinutes(window: JsonValue | undefined): number | undefined {
  const seconds =
    window !== undefined ? pickI64Http(window, [['limit_window_seconds'], ['limitWindowSeconds']]) : undefined
  if (seconds === undefined || seconds <= 0) return undefined
  return Math.trunc((seconds + 59) / 60)
}

function resetTime(window: JsonValue | undefined): number | undefined {
  const resetAt = window !== undefined ? pickI64Http(window, [['reset_at'], ['resetAt']]) : undefined
  if (resetAt !== undefined) return resetAt
  const seconds =
    window !== undefined ? pickI64Http(window, [['reset_after_seconds'], ['resetAfterSeconds']]) : undefined
  if (seconds === undefined) return undefined
  return Math.trunc(timestampToDate(Math.trunc(Date.now() / 1000) + seconds).getTime() / 1000)
}

function sameDate(a: Date | undefined, b: Date | undefined): boolean {
  if (a === undefined && b === undefined) return true
  if (a === undefined || b === undefined) return false
  return a.getTime() === b.getTime()
}
