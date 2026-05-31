// Qoder live quota fetch. 对应 quota/infrastructure/quota/qoder.rs.

import type { JsonValue } from '../../../account/domain/platform-account-profile'
import type { Credential } from '../../../account/domain/credential'
import type { QuotaFetchResult } from '../../domain/capabilities'
import {
  httpFetch,
  parseJson,
  pickStringHttp,
  providerError,
  successResult,
} from './common'

const OPENAPI_BASE_URL = 'https://openapi.qoder.sh'
const USER_INFO_PATH = '/api/v1/userinfo'
const USER_STATUS_PATH = '/api/v3/user/status'
const DATA_POLICY_PATH = '/api/v2/config/getDataPolicy'
const USER_PLAN_PATH = '/api/v2/user/plan'
const CREDIT_USAGE_PATH = '/api/v2/quota/usage'

export async function fetch(
  credential: Credential,
  profilePayload: JsonValue,
): Promise<QuotaFetchResult> {
  const baseUrl = OPENAPI_BASE_URL
  const accessToken =
    pickStringHttp(credential.rawMetadata, [['access_token'], ['auth_user_info_raw', 'token']]) ??
    credential.token

  let userInfo: JsonValue | undefined
  try {
    userInfo = await fetchOpenapiJson(baseUrl, USER_INFO_PATH, accessToken)
  } catch {
    userInfo = undefined
  }
  const userStatus = await fetchOpenapiJson(baseUrl, USER_STATUS_PATH, accessToken)
  let dataPolicy: JsonValue | undefined
  try {
    dataPolicy = await fetchOpenapiJson(baseUrl, DATA_POLICY_PATH, accessToken)
  } catch {
    dataPolicy = undefined
  }
  let userPlan: JsonValue | undefined
  try {
    userPlan = await fetchOpenapiJson(baseUrl, USER_PLAN_PATH, accessToken)
  } catch {
    userPlan = undefined
  }
  const creditUsage = await fetchOpenapiJson(baseUrl, CREDIT_USAGE_PATH, accessToken)

  const planType =
    (userPlan !== undefined ? pickStringHttp(userPlan, [['planType'], ['plan'], ['type']]) : undefined) ??
    pickStringHttp(userStatus, [['planType'], ['userType']])
  const email =
    (userInfo !== undefined ? pickStringHttp(userInfo, [['email'], ['data', 'email']]) : undefined) ??
    pickStringHttp(userStatus, [['email'], ['user', 'email']])
  const userId =
    (userInfo !== undefined
      ? pickStringHttp(userInfo, [['id'], ['uid'], ['data', 'id']])
      : undefined) ?? pickStringHttp(userStatus, [['id'], ['uid'], ['user', 'id']])

  const providerPayload = {
    ...(isObject(profilePayload) ? profilePayload : {}),
    email: email ?? null,
    user_id: userId ?? null,
    plan_type: planType ?? null,
    planName: planType ?? null,
    auth_user_info_raw: userInfo ?? null,
    auth_user_status_raw: userStatus,
    auth_data_policy_raw: dataPolicy ?? null,
    auth_user_plan_raw: userPlan ?? null,
    auth_credit_usage_raw: creditUsage,
  }

  return successResult('qoder', credential, providerPayload, undefined)
}

async function fetchOpenapiJson(
  baseUrl: string,
  path: string,
  accessToken: string,
): Promise<JsonValue> {
  const response = await httpFetch(
    `${baseUrl.replace(/\/+$/, '')}${path}`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'Cosy-ClientType': '0',
        'Cosy-MachineOS': machineOs(),
      },
    },
    '请求 Qoder OpenAPI 失败',
  )
  if (!response.ok) throw providerError(`Qoder OpenAPI 返回异常(${path}): status=${response.status}`)
  return parseJson(response, '解析 Qoder OpenAPI 响应失败')
}

function machineOs(): string {
  const arch = process.arch === 'arm64' ? 'aarch64' : process.arch
  const os = process.platform === 'darwin' ? 'darwin' : process.platform
  return `${arch}_${os}`
}

function isObject(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
