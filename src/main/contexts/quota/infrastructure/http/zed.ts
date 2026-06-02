// Zed live quota fetch.

import type { JsonValue } from '../../../account/domain/platform-account-profile'
import type { Credential } from '../../../account/domain/credential'
import type { QuotaFetchResult } from '../../domain/capabilities'
import {
  httpFetch,
  parseJson,
  pickI64Http,
  pickStringHttp,
  providerError,
  successResult,
} from './common'
import { getPathValue } from '../../domain/quota-state'

const CLOUD_BASE_URL = 'https://cloud.zed.dev'

export async function fetch(
  credential: Credential,
  profilePayload: JsonValue,
): Promise<QuotaFetchResult> {
  const userId =
    pickStringHttp(credential.rawMetadata, [
      ['user_id'],
      ['userId'],
      ['github_login'],
      ['githubLogin'],
    ]) ??
    pickStringHttp(profilePayload, [['user_id'], ['userId'], ['github_login'], ['githubLogin']])
  if (userId === undefined) throw providerError('Zed 缺少 user_id')
  const accessToken =
    pickStringHttp(credential.rawMetadata, [['access_token']]) ?? credential.token

  const userRaw = await fetchZedJson(userId, accessToken, '/client/users/me')
  const usageRaw = getPathValue(userRaw, ['plan', 'usage']) ?? {}

  const providerPayload = {
    ...(isObject(profilePayload) ? profilePayload : {}),
    user_id: pickStringHttp(userRaw, [['user', 'id'], ['id']]) ?? userId,
    github_login:
      pickStringHttp(userRaw, [
        ['user', 'github_login'],
        ['user', 'githubLogin'],
        ['github_login'],
        ['githubLogin'],
      ]) ?? null,
    display_name: pickStringHttp(userRaw, [['user', 'name'], ['name']]) ?? null,
    avatar_url:
      pickStringHttp(userRaw, [
        ['user', 'avatar_url'],
        ['user', 'avatarUrl'],
        ['avatar_url'],
        ['avatarUrl'],
      ]) ?? null,
    plan_raw:
      pickStringHttp(userRaw, [['plan', 'plan_v3'], ['plan', 'plan'], ['plan', 'name']]) ?? null,
    tokenSpendUsedCents:
      pickI64Http(usageRaw, [
        ['current_usage', 'token_spend', 'used'],
        ['token_spend', 'used'],
      ]) ?? null,
    tokenSpendLimitCents:
      pickI64Http(usageRaw, [
        ['current_usage', 'token_spend', 'limit'],
        ['token_spend', 'limit'],
      ]) ?? null,
    tokenSpendRemainingCents:
      pickI64Http(usageRaw, [
        ['current_usage', 'token_spend', 'remaining'],
        ['token_spend', 'remaining'],
      ]) ?? null,
    editPredictionsUsed:
      pickI64Http(usageRaw, [
        ['current_usage', 'edit_predictions', 'used'],
        ['edit_predictions', 'used'],
      ]) ?? null,
    editPredictionsLimitRaw:
      pickStringHttp(usageRaw, [
        ['current_usage', 'edit_predictions', 'limit'],
        ['edit_predictions', 'limit'],
      ]) ?? null,
    editPredictionsRemainingRaw:
      pickStringHttp(usageRaw, [
        ['current_usage', 'edit_predictions', 'remaining'],
        ['edit_predictions', 'remaining'],
      ]) ?? null,
    user_raw: userRaw,
    usage_raw: usageRaw,
  }

  return successResult('zed', credential, providerPayload, undefined)
}

async function fetchZedJson(
  userId: string,
  accessToken: string,
  path: string,
): Promise<JsonValue> {
  const response = await httpFetch(
    `${CLOUD_BASE_URL.replace(/\/+$/, '')}${path}`,
    {
      method: 'GET',
      headers: {
        Authorization: `${userId.trim()} ${accessToken.trim()}`,
        'User-Agent': 'haoxiaoguan/zed',
      },
    },
    '请求 Zed 接口失败',
  )
  if (!response.ok) throw providerError(`Zed 接口返回异常: status=${response.status}`)
  return parseJson(response, '解析 Zed 响应失败')
}

function isObject(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
