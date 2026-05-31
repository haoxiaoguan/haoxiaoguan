// Gemini CLI live quota fetch. 对应 quota/infrastructure/quota/gemini.rs.
//
// Refresh on expiry (form-encoded, embedded installed-app client_id/secret) →
// loadCodeAssist → userinfo + retrieveUserQuota (project-scoped). provider_payload
// feeds the gemini remaining-percent parser.

import type { JsonValue } from '../../../account/domain/platform-account-profile'
import { Credential } from '../../../account/domain/credential'
import type { QuotaFetchResult } from '../../domain/capabilities'
import {
  credentialWithPayload,
  httpFetch,
  normalizeNonEmpty,
  parseJson,
  pickStringHttp,
  providerError,
  successResult,
} from './common'
import { getPathValue } from '../../domain/quota-state'

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v2/userinfo'
const LOAD_CODE_ASSIST_ENDPOINT = 'https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist'
const RETRIEVE_USER_QUOTA_ENDPOINT =
  'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota'
const CLIENT_ID = '681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com'
// Public installed-app secret (same pattern as gcloud CLI). See manifest porting note.
const CLIENT_SECRET = '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'

export async function fetch(
  credential: Credential,
  profilePayload: JsonValue,
): Promise<QuotaFetchResult> {
  let accessToken = credential.token
  let refreshToken = credential.refreshToken
  let expiresAt = credential.expiresAt
  let updated: Credential | undefined

  if (expiresAt !== undefined && expiresAt.getTime() <= Date.now() + 60_000) {
    const refresh = normalizeNonEmpty(refreshToken)
    if (refresh !== undefined) {
      const token = await refreshAccessToken(refresh)
      const nextAccess = pickStringHttp(token, [['access_token'], ['accessToken']])
      if (nextAccess !== undefined) accessToken = nextAccess
      refreshToken = pickStringHttp(token, [['refresh_token'], ['refreshToken']]) ?? refreshToken
      const expiresIn = getPathValue(token, ['expires_in'])
      if (typeof expiresIn === 'number') expiresAt = new Date(Date.now() + expiresIn * 1000)
    }
  }

  const load = await loadCodeAssist(accessToken)
  const projectId = pickProjectId(load)
  let userinfo: JsonValue | undefined
  try {
    userinfo = await fetchUserinfo(accessToken)
  } catch {
    userinfo = undefined
  }
  let usage: JsonValue | undefined
  if (projectId !== undefined) {
    try {
      usage = await retrieveUserQuota(accessToken, projectId)
    } catch {
      usage = undefined
    }
  }
  const tierId = pickStringHttp(load, [
    ['paidTier', 'id'],
    ['currentTier', 'id'],
    ['allowedTiers', '0', 'id'],
  ])
  const planName =
    pickStringHttp(load, [
      ['paidTier', 'name'],
      ['currentTier', 'name'],
      ['allowedTiers', '0', 'name'],
    ]) ?? tierId

  const providerPayload = {
    ...(isObject(profilePayload) ? profilePayload : {}),
    email: userinfo !== undefined ? pickStringHttp(userinfo, [['email']]) ?? null : null,
    authId: userinfo !== undefined ? pickStringHttp(userinfo, [['id']]) ?? null : null,
    name: userinfo !== undefined ? pickStringHttp(userinfo, [['name']]) ?? null : null,
    projectId: projectId ?? null,
    tierId: tierId ?? null,
    planName: planName ?? null,
    gemini_load_code_assist_raw: load,
    gemini_usage_raw: usage ?? null,
  }

  if (
    accessToken !== credential.token ||
    refreshToken !== credential.refreshToken ||
    !sameDate(expiresAt, credential.expiresAt)
  ) {
    updated = credentialWithPayload(credential, accessToken, refreshToken, expiresAt, providerPayload)
  }

  return successResult('gemini_cli', credential, providerPayload, updated)
}

async function refreshAccessToken(refreshToken: string): Promise<JsonValue> {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  })
  const response = await httpFetch(
    TOKEN_ENDPOINT,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    },
    '刷新 Gemini access_token 请求失败',
  )
  if (!response.ok) throw providerError(`刷新 Gemini access_token 失败: status=${response.status}`)
  return parseJson(response, '解析 Gemini access_token 刷新响应失败')
}

async function loadCodeAssist(accessToken: string): Promise<JsonValue> {
  return postCodeAssist(LOAD_CODE_ASSIST_ENDPOINT, accessToken, {
    metadata: {
      ideType: 'IDE_UNSPECIFIED',
      platform: 'PLATFORM_UNSPECIFIED',
      pluginType: 'GEMINI',
    },
  })
}

async function retrieveUserQuota(accessToken: string, projectId: string): Promise<JsonValue> {
  return postCodeAssist(RETRIEVE_USER_QUOTA_ENDPOINT, accessToken, { project: projectId })
}

async function postCodeAssist(
  endpoint: string,
  accessToken: string,
  payload: JsonValue,
): Promise<JsonValue> {
  const response = await httpFetch(
    endpoint,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    '请求 Gemini Code Assist 失败',
  )
  if (!response.ok) throw providerError(`Gemini Code Assist 返回异常: status=${response.status}`)
  return parseJson(response, '解析 Gemini Code Assist 响应失败')
}

async function fetchUserinfo(accessToken: string): Promise<JsonValue> {
  const response = await httpFetch(
    USERINFO_ENDPOINT,
    { method: 'GET', headers: { Authorization: `Bearer ${accessToken}` } },
    '请求 Gemini userinfo 失败',
  )
  if (!response.ok) throw providerError(`Gemini userinfo 返回异常: status=${response.status}`)
  return parseJson(response, '解析 Gemini userinfo 失败')
}

function pickProjectId(load: JsonValue): string | undefined {
  return pickStringHttp(load, [
    ['cloudaicompanionProject'],
    ['cloudaicompanionProject', 'id'],
    ['cloudaicompanionProject', 'projectId'],
  ])
}

function isObject(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sameDate(a: Date | undefined, b: Date | undefined): boolean {
  if (a === undefined && b === undefined) return true
  if (a === undefined || b === undefined) return false
  return a.getTime() === b.getTime()
}
