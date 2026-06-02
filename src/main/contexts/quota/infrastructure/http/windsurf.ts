// Windsurf live quota fetch.
//
// SeatManagementService GetCurrentUser/GetPlanStatus/GetUserStatus calls. The
// snapshots are packed under copilot_quota_snapshots so the shared copilot parser
// (registered for windsurf) can read them.

import type { JsonValue } from '../../../account/domain/platform-account-profile'
import type { Credential } from '../../../account/domain/credential'
import type { QuotaFetchResult } from '../../domain/capabilities'
import {
  httpFetch,
  mergePayload,
  normalizeNonEmpty,
  parseJson,
  pickStringHttp,
  providerError,
  successResult,
} from './common'
import { getPathValue } from '../../domain/quota-state'

const DEFAULT_API_SERVER_URL = 'https://server.codeium.com'

export async function fetch(
  credential: Credential,
  profilePayload: JsonValue,
): Promise<QuotaFetchResult> {
  const apiKey =
    pickStringHttp(credential.rawMetadata, [['windsurf_api_key'], ['apiKey'], ['api_key']]) ??
    credential.token
  const apiServerUrl =
    pickStringHttp(credential.rawMetadata, [
      ['windsurf_api_server_url'],
      ['apiServerUrl'],
      ['api_server_url'],
    ]) ??
    pickStringHttp(profilePayload, [
      ['windsurf_api_server_url'],
      ['windsurfApiServerUrl'],
      ['apiServerUrl'],
      ['api_server_url'],
    ]) ??
    DEFAULT_API_SERVER_URL
  const authToken =
    normalizeNonEmpty(credential.refreshToken) ??
    pickStringHttp(credential.rawMetadata, [['windsurf_auth_token'], ['authToken'], ['auth_token']])

  let currentUser: JsonValue | undefined
  let planStatus: JsonValue | undefined
  if (authToken !== undefined) {
    try {
      currentUser = await postSeatManagementJson(apiServerUrl, 'GetCurrentUser', {
        authToken,
        includeSubscription: true,
      })
    } catch {
      currentUser = undefined
    }
    try {
      planStatus = await postSeatManagementJson(apiServerUrl, 'GetPlanStatus', {
        authToken,
        includeTopUpStatus: true,
      })
    } catch {
      planStatus = undefined
    }
  }
  const userStatus = await postSeatManagementJson(apiServerUrl, 'GetUserStatus', {
    metadata: userStatusMetadata(apiKey),
  })

  const currentUserObj = currentUser !== undefined ? getPathValue(currentUser, ['user']) : undefined
  const statusObj = getPathValue(userStatus, ['userStatus'])
  const email =
    (currentUserObj !== undefined ? pickStringHttp(currentUserObj, [['email']]) : undefined) ??
    (statusObj !== undefined ? pickStringHttp(statusObj, [['email']]) : undefined)
  const planName =
    planStatus !== undefined
      ? pickStringHttp(planStatus, [
          ['planStatus', 'planInfo', 'planName'],
          ['planStatus', 'planInfo', 'plan_name'],
        ])
      : undefined

  const providerPayload = mergePayload(profilePayload, {
    email: email ?? null,
    planName: planName ?? null,
    copilot_plan: planName ?? null,
    copilot_chat_enabled: true,
    copilot_quota_snapshots: {
      windsurfPlanStatus:
        planStatus !== undefined ? getPathValue(planStatus, ['planStatus']) ?? null : null,
      windsurfUserStatus: getPathValue(userStatus, ['userStatus']) ?? null,
      windsurfCurrentUser: currentUserObj ?? null,
    },
    windsurf_api_server_url: apiServerUrl,
    windsurf_user_status: userStatus,
    windsurf_plan_status: planStatus ?? null,
    windsurf_current_user: currentUser ?? null,
  })

  return successResult('windsurf', credential, providerPayload, undefined)
}

async function postSeatManagementJson(
  baseUrl: string,
  method: string,
  body: JsonValue,
): Promise<JsonValue> {
  const url = `${baseUrl.replace(/\/+$/, '')}/exa.seat_management_pb.SeatManagementService/${method}`
  const response = await httpFetch(
    url,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'haoxiaoguan',
      },
      body: JSON.stringify(body),
    },
    `请求 Windsurf ${method} 失败`,
  )
  if (!response.ok) throw providerError(`Windsurf ${method} 返回异常: status=${response.status}`)
  return parseJson(response, `解析 Windsurf ${method} 响应失败`)
}

function userStatusMetadata(apiKey: string): JsonValue {
  const os = process.platform === 'darwin' ? 'darwin' : process.platform
  const ts = Math.trunc(Date.now() / 1000)
  return {
    apiKey,
    ideName: 'Windsurf',
    ideVersion: '1.0.0',
    extensionName: 'codeium.windsurf',
    extensionVersion: '1.0.0',
    locale: 'zh-CN',
    os,
    disableTelemetry: false,
    sessionId: `haoxiaoguan-${ts}`,
    requestId: String(ts),
  }
}
