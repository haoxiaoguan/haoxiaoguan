// CodeBuddy live quota fetch.

import type { JsonValue } from '../../../account/domain/platform-account-profile'
import { Credential } from '../../../account/domain/credential'
import type { PlatformId } from '../../domain/platform-id'
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

const CODEBUDDY_API_ENDPOINT = 'https://www.codebuddy.ai'
const CODEBUDDY_CN_API_ENDPOINT = 'https://www.codebuddy.cn'
const API_PREFIX = '/v2/plugin'

export async function fetch(
  platform: PlatformId,
  credential: Credential,
  profilePayload: JsonValue,
): Promise<QuotaFetchResult> {
  const endpoint = endpointFor(platform)
  let accessToken = credential.token
  let refreshToken = credential.refreshToken
  let expiresAt = credential.expiresAt
  const domain =
    pickStringHttp(credential.rawMetadata, [['domain']]) ??
    pickStringHttp(profilePayload, [['domain']])

  const refresh = normalizeNonEmpty(refreshToken)
  if (refresh !== undefined) {
    try {
      const token = await refreshTokenRequest(endpoint, accessToken, refresh, domain)
      const nextAccess = pickStringHttp(token, [['accessToken'], ['access_token']])
      if (nextAccess !== undefined) accessToken = nextAccess
      refreshToken = pickStringHttp(token, [['refreshToken'], ['refresh_token']]) ?? refreshToken
      const expTs = pickI64Http(token, [['expiresAt'], ['expires_at']])
      if (expTs !== undefined) expiresAt = timestampToDate(expTs)
    } catch {
      // refresh failures are non-fatal
    }
  }

  const uid =
    pickStringHttp(credential.rawMetadata, [['uid'], ['userId']]) ??
    pickStringHttp(profilePayload, [['uid'], ['userId'], ['user_id']])
  const enterpriseId =
    pickStringHttp(credential.rawMetadata, [['enterprise_id'], ['enterpriseId']]) ??
    pickStringHttp(profilePayload, [['enterprise_id'], ['enterpriseId']])

  let dosage: JsonValue | undefined
  try {
    dosage = await postCodebuddyJson(
      endpoint,
      '/v2/billing/meter/get-dosage-notify',
      accessToken,
      uid,
      enterpriseId,
      domain,
      undefined,
    )
  } catch {
    dosage = undefined
  }
  let payment: JsonValue | undefined
  try {
    payment = await postCodebuddyJson(
      endpoint,
      '/v2/billing/meter/get-payment-type',
      accessToken,
      uid,
      enterpriseId,
      domain,
      undefined,
    )
  } catch {
    payment = undefined
  }
  const userResource = await postCodebuddyJson(
    endpoint,
    '/v2/billing/meter/get-user-resource',
    accessToken,
    uid,
    enterpriseId,
    domain,
    defaultUserResourceBody(),
  )

  const quotaRaw = {
    dosage: dosage ?? null,
    payment: payment ?? null,
    userResource,
  }
  let paymentType: string | undefined
  if (payment !== undefined) {
    const data = getPathValue(payment, ['data'])
    if (typeof data === 'string') paymentType = data
    else if (data !== undefined) paymentType = pickStringHttp(data, [['paymentType'], ['payment_type']])
  }

  const providerPayload = {
    ...(isObject(profilePayload) ? profilePayload : {}),
    uid: uid ?? null,
    enterprise_id: enterpriseId ?? null,
    domain: domain ?? null,
    paymentType: paymentType ?? null,
    planName: paymentType ?? null,
    quota_raw: quotaRaw,
    usage_raw: userResource,
  }

  let updated: Credential | undefined
  if (
    accessToken !== credential.token ||
    refreshToken !== credential.refreshToken ||
    !sameDate(expiresAt, credential.expiresAt)
  ) {
    updated = credentialWithPayload(credential, accessToken, refreshToken, expiresAt, providerPayload)
  }

  return successResult(platform, credential, providerPayload, updated)
}

function endpointFor(platform: PlatformId): string {
  return platform === 'codebuddy_cn' ? CODEBUDDY_CN_API_ENDPOINT : CODEBUDDY_API_ENDPOINT
}

async function refreshTokenRequest(
  endpoint: string,
  accessToken: string,
  refreshToken: string,
  domain: string | undefined,
): Promise<JsonValue> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'X-Refresh-Token': refreshToken,
    'Content-Type': 'application/json',
  }
  if (domain !== undefined) headers['X-Domain'] = domain
  const response = await httpFetch(
    `${endpoint}${API_PREFIX}/auth/token/refresh`,
    { method: 'POST', headers, body: JSON.stringify({}) },
    'CodeBuddy token 刷新失败',
  )
  if (!response.ok) throw providerError(`CodeBuddy token 刷新返回异常: status=${response.status}`)
  return parseJson(response, '解析 CodeBuddy token 刷新响应失败')
}

async function postCodebuddyJson(
  endpoint: string,
  path: string,
  accessToken: string,
  uid: string | undefined,
  enterpriseId: string | undefined,
  domain: string | undefined,
  body: JsonValue | undefined,
): Promise<JsonValue> {
  const headers: Record<string, string> = {
    Accept: 'application/json, text/plain, */*',
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  }
  if (uid !== undefined) headers['X-User-Id'] = uid
  if (enterpriseId !== undefined) {
    headers['X-Enterprise-Id'] = enterpriseId
    headers['X-Tenant-Id'] = enterpriseId
  }
  if (domain !== undefined) headers['X-Domain'] = domain
  const response = await httpFetch(
    `${endpoint}${path}`,
    { method: 'POST', headers, body: JSON.stringify(body ?? {}) },
    '请求 CodeBuddy 额度接口失败',
  )
  if (!response.ok) throw providerError(`CodeBuddy 额度接口返回异常: status=${response.status}`)
  return parseJson(response, '解析 CodeBuddy 额度响应失败')
}

function defaultUserResourceBody(): JsonValue {
  const begin = formatLocal(new Date())
  const end = formatLocal(new Date(Date.now() + 365 * 101 * 24 * 60 * 60 * 1000))
  return {
    PageNumber: 1,
    PageSize: 100,
    ProductCode: 'p_tcaca',
    Status: [0, 3],
    PackageEndTimeRangeBegin: begin,
    PackageEndTimeRangeEnd: end,
  }
}

function formatLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function isObject(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sameDate(a: Date | undefined, b: Date | undefined): boolean {
  if (a === undefined && b === undefined) return true
  if (a === undefined || b === undefined) return false
  return a.getTime() === b.getTime()
}
