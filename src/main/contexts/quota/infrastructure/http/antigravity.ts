// Antigravity live quota fetch.
//
// Antigravity is a Google CloudCode product (same host as Gemini CLI). Flow
// mirrors cockpit-tools modules/quota.rs:
//   refresh (Antigravity installed-app client) → loadCodeAssist (metadata
//   ideType=ANTIGRAVITY, pluginType=GEMINI; FULL_ELIGIBILITY_CHECK) → resolve
//   project id (from response, else onboardUser with the default allowed tier) →
//   retrieveUserQuotaSummary → groups[].buckets[]
//     { bucketId, displayName, remainingFraction, resetTime }.
// provider_payload feeds the antigravity quota-state bucket parser.
//
// A TOS_VIOLATION / PERMISSION_DENIED response means Google disabled the account
// (banned); we surface that as a clear error instead of a silent "unknown".
//
// retrieveUserQuotaSummary (unlike loadCodeAssist) 会对没有可识别 User-Agent 的
// 请求直接判 403 PERMISSION_DENIED——跟账号本身是否被封无关，纯粹是"这请求不像
// 官方 Antigravity 客户端发的"。真机验证过：同一账号、同一 access_token，只补一个
// User-Agent 头（不需要其它头）就从 403 变 200，quota 数据跟 App 里看到的完全对得
// 上。所以必须带上这条 UA（以及 x-goog-api-client，对齐参考实现两者都发），否则
// ensureNotBanned() 会把这个「请求被拒」误判成「账号被封」。

import type { JsonValue } from '../../../account/domain/platform-account-profile'
import { Credential } from '../../../account/domain/credential'
import type { QuotaFetchResult } from '../../domain/capabilities'
import {
  credentialWithPayload,
  httpFetch,
  normalizeNonEmpty,
  pickStringHttp,
  providerError,
  successResult,
} from './common'
import { getPathValue } from '../../domain/quota-state'

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v2/userinfo'
const BASE_URL = 'https://cloudcode-pa.googleapis.com'
const LOAD_CODE_ASSIST_ENDPOINT = `${BASE_URL}/v1internal:loadCodeAssist`
const ONBOARD_USER_ENDPOINT = `${BASE_URL}/v1internal:onboardUser`
const QUOTA_SUMMARY_ENDPOINT = `${BASE_URL}/v1internal:retrieveUserQuotaSummary`
// Antigravity desktop installed-app OAuth client (same values as antigravity-oauth).
const CLIENT_ID = '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com'
const CLIENT_SECRET = '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'
const ONBOARD_POLL_ATTEMPTS = 6
const ONBOARD_POLL_DELAY_MS = 600

// loadCodeAssist metadata identifying the Antigravity IDE (mirrors
// build_cloud_code_metadata).
const CLOUD_CODE_METADATA: JsonValue = {
  ideName: 'antigravity',
  ideType: 'ANTIGRAVITY',
  platform: 'PLATFORM_UNSPECIFIED',
  pluginType: 'GEMINI',
}

// Mirrors cockpit-tools quota.rs's load_code_assist_user_agent /
// _x_goog_api_client (DEFAULT_LOAD_CODE_ASSIST_USER_AGENT falls back to the
// same "antigravity/<ver> <os>/<arch> google-api-nodejs-client/<ver>" shape
// when the real installed IDE version is unknown, which is always the case
// here since we're not the IDE itself).
const CLOUD_CODE_IDE_VERSION = '1.20.5'
const GOOGLE_API_NODEJS_CLIENT_VERSION = '10.3.0'

function cloudCodeUserAgentOs(): string {
  switch (process.platform) {
    case 'darwin':
      return 'darwin'
    case 'win32':
      return 'windows'
    case 'linux':
      return 'linux'
    default:
      return 'windows'
  }
}

function cloudCodeUserAgentArch(): string {
  return process.arch === 'arm64' ? 'arm64' : 'amd64'
}

function cloudCodeHeaders(): Record<string, string> {
  return {
    'User-Agent': `antigravity/${CLOUD_CODE_IDE_VERSION} ${cloudCodeUserAgentOs()}/${cloudCodeUserAgentArch()} google-api-nodejs-client/${GOOGLE_API_NODEJS_CLIENT_VERSION}`,
    'x-goog-api-client': `gl-node/${process.versions.node}`,
    Accept: '*/*',
    'Accept-Encoding': 'gzip, deflate, br',
  }
}

interface CodeAssistResponse {
  ok: boolean
  status: number
  json: JsonValue
}

export async function fetch(
  credential: Credential,
  profilePayload: JsonValue,
): Promise<QuotaFetchResult> {
  let accessToken = credential.token
  let refreshToken = credential.refreshToken
  let expiresAt = credential.expiresAt
  let updated: Credential | undefined

  if (expiresAt === undefined || expiresAt.getTime() <= Date.now() + 60_000) {
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
  ensureNotBanned(load)
  let projectId = pickProjectId(load.json)
  if (projectId === undefined) {
    // Not onboarded yet — provision a cloudaicompanion project with the default
    // allowed tier (or the first one), mirroring the reference onboardUser flow.
    const tierId = pickOnboardTier(load.json)
    if (tierId !== undefined) {
      try {
        projectId = await onboardUser(accessToken, tierId)
      } catch {
        projectId = undefined
      }
    }
  }

  let userinfo: JsonValue | undefined
  try {
    userinfo = await fetchUserinfo(accessToken)
  } catch {
    userinfo = undefined
  }

  const summaryRes = await retrieveUserQuotaSummary(accessToken, projectId)
  ensureNotBanned(summaryRes)
  const summary = summaryRes.ok ? summaryRes.json : undefined

  const tierId = pickStringHttp(load.json, [
    ['currentTier', 'id'],
    ['paidTier', 'id'],
    ['allowedTiers', '0', 'id'],
  ])
  const planName =
    pickStringHttp(load.json, [
      ['currentTier', 'name'],
      ['paidTier', 'name'],
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
    antigravity_load_code_assist_raw: load.json,
    antigravity_quota_summary_raw: summary ?? null,
  }

  if (
    accessToken !== credential.token ||
    refreshToken !== credential.refreshToken ||
    !sameDate(expiresAt, credential.expiresAt)
  ) {
    updated = credentialWithPayload(credential, accessToken, refreshToken, expiresAt, providerPayload)
  }

  return successResult('antigravity', credential, providerPayload, updated)
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
    '刷新 Antigravity access_token 请求失败',
  )
  if (!response.ok) {
    throw providerError(`刷新 Antigravity access_token 失败: status=${response.status}`)
  }
  return (await response.json()) as JsonValue
}

async function loadCodeAssist(accessToken: string): Promise<CodeAssistResponse> {
  return postCodeAssist(LOAD_CODE_ASSIST_ENDPOINT, accessToken, {
    metadata: CLOUD_CODE_METADATA,
    mode: 'FULL_ELIGIBILITY_CHECK',
  })
}

// onboardUser: provision a cloudaicompanion project. Returns a long-running
// operation that we poll until done, then read response.cloudaicompanionProject.
async function onboardUser(accessToken: string, tierId: string): Promise<string | undefined> {
  let res = await postCodeAssist(ONBOARD_USER_ENDPOINT, accessToken, {
    tierId,
    metadata: CLOUD_CODE_METADATA,
  })
  ensureNotBanned(res)
  for (let attempt = 0; attempt < ONBOARD_POLL_ATTEMPTS; attempt += 1) {
    const done = getPathValue(res.json, ['done'])
    if (done === true) break
    const opName = pickStringHttp(res.json, [['name']])
    if (opName === undefined) break
    await delay(ONBOARD_POLL_DELAY_MS)
    const response = await httpFetch(
      `${BASE_URL}/v1internal/${opName}`,
      { method: 'GET', headers: { Authorization: `Bearer ${accessToken}`, ...cloudCodeHeaders() } },
      '轮询 Antigravity onboardUser 失败',
    )
    res = { ok: response.ok, status: response.status, json: (await response.json()) as JsonValue }
  }
  return pickStringHttp(res.json, [
    ['response', 'cloudaicompanionProject', 'id'],
    ['response', 'cloudaicompanionProject'],
    ['cloudaicompanionProject', 'id'],
    ['cloudaicompanionProject'],
  ])
}

async function retrieveUserQuotaSummary(
  accessToken: string,
  projectId: string | undefined,
): Promise<CodeAssistResponse> {
  const payload: JsonValue = projectId !== undefined ? { project: projectId } : {}
  return postCodeAssist(QUOTA_SUMMARY_ENDPOINT, accessToken, payload)
}

async function postCodeAssist(
  endpoint: string,
  accessToken: string,
  payload: JsonValue,
): Promise<CodeAssistResponse> {
  const response = await httpFetch(
    endpoint,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...cloudCodeHeaders(),
      },
      body: JSON.stringify(payload),
    },
    '请求 Antigravity Code Assist 失败',
  )
  let json: JsonValue = null
  try {
    json = (await response.json()) as JsonValue
  } catch {
    json = null
  }
  return { ok: response.ok, status: response.status, json }
}

// Detect Google's TOS-violation / permission-denied ban and surface it as a
// clear error (otherwise the card would just show "额度未知").
function ensureNotBanned(res: CodeAssistResponse): void {
  if (res.ok) return
  const status = pickStringHttp(res.json, [['error', 'status']])
  const reason = pickStringHttp(res.json, [['error', 'details', '0', 'reason']])
  const message = pickStringHttp(res.json, [['error', 'message']])
  if (reason === 'TOS_VIOLATION' || status === 'PERMISSION_DENIED') {
    throw providerError(
      `Antigravity 账号已被 Google 禁用（${reason ?? status}）：${message ?? '服务不可用，需提交申诉'}`,
    )
  }
}

async function fetchUserinfo(accessToken: string): Promise<JsonValue> {
  const response = await httpFetch(
    USERINFO_ENDPOINT,
    { method: 'GET', headers: { Authorization: `Bearer ${accessToken}` } },
    '请求 Antigravity userinfo 失败',
  )
  if (!response.ok) throw providerError(`Antigravity userinfo 返回异常: status=${response.status}`)
  return (await response.json()) as JsonValue
}

function pickProjectId(load: JsonValue): string | undefined {
  return pickStringHttp(load, [
    ['cloudaicompanionProject', 'id'],
    ['cloudaicompanionProject', 'projectId'],
    ['cloudaicompanionProject'],
  ])
}

// Pick the tier to onboard with: the default allowed tier, else the first with
// an id (mirrors pick_onboard_tier).
function pickOnboardTier(load: JsonValue): string | undefined {
  const tiers = getPathValue(load, ['allowedTiers'])
  if (!Array.isArray(tiers)) return undefined
  const isDefault = tiers.find((t) => getPathValue(t, ['isDefault']) === true)
  const fromDefault = isDefault !== undefined ? pickStringHttp(isDefault, [['id']]) : undefined
  if (fromDefault !== undefined) return fromDefault
  for (const t of tiers) {
    const id = pickStringHttp(t, [['id']])
    if (id !== undefined) return id
  }
  return undefined
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isObject(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sameDate(a: Date | undefined, b: Date | undefined): boolean {
  if (a === undefined && b === undefined) return true
  if (a === undefined || b === undefined) return false
  return a.getTime() === b.getTime()
}
