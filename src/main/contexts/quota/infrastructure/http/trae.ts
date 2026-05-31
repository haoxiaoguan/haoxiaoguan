// Trae live quota fetch. 对应 quota/infrastructure/quota/trae.rs.

import type { JsonValue } from '../../../account/domain/platform-account-profile'
import type { Credential } from '../../../account/domain/credential'
import type { QuotaFetchResult } from '../../domain/capabilities'
import {
  httpFetch,
  normalizeNonEmpty,
  parseJson,
  pickStringHttp,
  providerError,
  successResult,
} from './common'
import { getPathValue } from '../../domain/quota-state'

const ACCOUNT_API_ORIGIN_NORMAL = 'https://grow-normal.trae.ai'
const GET_USER_INFO_PATH = '/cloudide/api/v3/trae/GetUserInfo'
const CHECK_LOGIN_PATH = '/cloudide/api/v3/trae/CheckLogin'
const PAY_STATUS_PATH = '/trae/api/v1/pay/ide_user_pay_status'
const ENT_USAGE_PATH = '/trae/api/v1/pay/ide_user_ent_usage'
const IDE_VERSION = '1.0.0'

export async function fetch(
  credential: Credential,
  profilePayload: JsonValue,
): Promise<QuotaFetchResult> {
  const accessToken =
    pickStringHttp(credential.rawMetadata, [['access_token']]) ?? credential.token
  const loginHost = resolveLoginHost(credential.rawMetadata, profilePayload)
  const cookie = pickStringHttp(credential.rawMetadata, [
    ['cookie'],
    ['trae_auth_raw', 'cookie'],
    ['trae_auth_raw', 'Cookie'],
  ])

  let profile: JsonValue | undefined
  try {
    profile = await requestTraeJson('POST', `${loginHost}${GET_USER_INFO_PATH}`, accessToken, cookie, {}, false)
  } catch {
    profile = undefined
  }
  let checkLogin: JsonValue | undefined
  try {
    checkLogin = await requestTraeJson(
      'POST',
      `${loginHost}${CHECK_LOGIN_PATH}`,
      accessToken,
      cookie,
      { IDEVersion: IDE_VERSION },
      false,
    )
  } catch {
    checkLogin = undefined
  }
  let entitlement: JsonValue | undefined
  try {
    entitlement = await requestTraeJson('POST', `${loginHost}${PAY_STATUS_PATH}`, accessToken, cookie, {}, true)
  } catch {
    entitlement = undefined
  }
  const usage = await requestTraeJson(
    'POST',
    `${loginHost}${ENT_USAGE_PATH}`,
    accessToken,
    cookie,
    { require_usage: true },
    true,
  )

  const profileRoot =
    profile !== undefined
      ? getPathValue(profile, ['Result']) ??
        getPathValue(profile, ['result']) ??
        getPathValue(profile, ['data']) ??
        profile
      : undefined
  const email =
    profileRoot !== undefined
      ? pickStringHttp(profileRoot, [
          ['NonPlainTextEmail'],
          ['Email'],
          ['email'],
          ['user', 'email'],
          ['userInfo', 'email'],
        ])
      : undefined
  const planType =
    usagePlanType(usage) ??
    (entitlement !== undefined ? pickStringHttp(entitlement, [['user_pay_identity_str']]) : undefined)

  const providerPayload = {
    ...(isObject(profilePayload) ? profilePayload : {}),
    email: email ?? null,
    plan_type: planType ?? null,
    planName: planType ?? null,
    trae_profile_raw: profile ?? null,
    trae_server_raw: checkLogin ?? null,
    trae_entitlement_raw: entitlement ?? null,
    trae_usage_raw: usage,
  }

  return successResult('trae', credential, providerPayload, undefined)
}

async function requestTraeJson(
  method: string,
  url: string,
  accessToken: string,
  cookie: string | undefined,
  body: JsonValue | undefined,
  payAuth: boolean,
): Promise<JsonValue> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': 'Trae/1.0.0 haoxiaoguan',
    Authorization: payAuth ? `Cloud-IDE-JWT ${accessToken}` : `Bearer ${accessToken}`,
  }
  if (!payAuth) headers['x-cloudide-token'] = accessToken
  const cookieValue = normalizeNonEmpty(cookie)
  if (cookieValue !== undefined) headers['Cookie'] = cookieValue
  const init: RequestInit = { method, headers }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(body)
  }
  const response = await httpFetch(url, init, `请求 Trae 接口失败(${url})`)
  if (!response.ok) throw providerError(`Trae 接口返回异常(${url}): status=${response.status}`)
  return parseJson(response, `解析 Trae 响应失败(${url})`)
}

function resolveLoginHost(rawMetadata: JsonValue | undefined, profilePayload: JsonValue): string {
  return (
    pickStringHttp(profilePayload, [['loginHost'], ['host'], ['trae_server_raw', 'loginHost']]) ??
    pickStringHttp(rawMetadata, [
      ['trae_server_raw', 'loginHost'],
      ['trae_auth_raw', 'loginHost'],
      ['loginHost'],
      ['host'],
    ]) ??
    ACCOUNT_API_ORIGIN_NORMAL
  )
}

function usagePlanType(usage: JsonValue): string | undefined {
  const packsValue =
    getPathValue(usage, ['user_entitlement_pack_list']) ??
    getPathValue(usage, ['userEntitlementPackList'])
  if (!Array.isArray(packsValue)) return undefined
  for (const target of [6, 4, 1, 9, 8, 0]) {
    if (packsValue.some((pack) => productType(pack) === target)) {
      switch (target) {
        case 6:
          return 'Ultra'
        case 4:
          return 'Pro+'
        case 1:
        case 9:
          return 'Pro'
        case 8:
          return 'Lite'
        default:
          return 'Free'
      }
    }
  }
  return undefined
}

function productType(pack: JsonValue): number | undefined {
  const base =
    getPathValue(pack, ['entitlement_base_info']) ?? getPathValue(pack, ['entitlementBaseInfo'])
  const raw =
    (base !== undefined
      ? getPathValue(base, ['product_type']) ?? getPathValue(base, ['productType'])
      : undefined) ??
    getPathValue(pack, ['product_type']) ??
    getPathValue(pack, ['productType'])
  if (typeof raw === 'number' && Number.isInteger(raw)) return raw
  if (typeof raw === 'string') {
    const parsed = Number.parseInt(raw.trim(), 10)
    return Number.isNaN(parsed) ? undefined : parsed
  }
  return undefined
}

function isObject(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
