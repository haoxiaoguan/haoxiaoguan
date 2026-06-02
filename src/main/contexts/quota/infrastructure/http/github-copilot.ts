// GitHub Copilot live quota fetch.

import type { JsonValue } from '../../../account/domain/platform-account-profile'
import type { Credential } from '../../../account/domain/credential'
import type { QuotaFetchResult } from '../../domain/capabilities'
import {
  httpFetch,
  mergePayload,
  parseJson,
  pickStringHttp,
  providerError,
  successResult,
} from './common'
import { getPathValue } from '../../domain/quota-state'

const GITHUB_USER_ENDPOINT = 'https://api.github.com/user'
const COPILOT_TOKEN_ENDPOINT = 'https://api.github.com/copilot_internal/v2/token'
const COPILOT_USER_INFO_ENDPOINT = 'https://api.github.com/copilot_internal/user'

export async function fetch(
  credential: Credential,
  profilePayload: JsonValue,
): Promise<QuotaFetchResult> {
  const githubToken =
    pickStringHttp(credential.rawMetadata, [['github_access_token'], ['access_token']]) ??
    credential.token

  let githubUser: JsonValue | undefined
  try {
    githubUser = await getGithubJson(GITHUB_USER_ENDPOINT, githubToken, true)
  } catch {
    githubUser = undefined
  }
  const copilotToken = await getGithubJson(COPILOT_TOKEN_ENDPOINT, githubToken, false)
  let copilotUser: JsonValue | undefined
  try {
    copilotUser = await getGithubJson(COPILOT_USER_INFO_ENDPOINT, githubToken, false)
  } catch {
    copilotUser = undefined
  }

  const plan =
    (copilotUser !== undefined
      ? pickStringHttp(copilotUser, [['copilot_plan'], ['copilotPlan']])
      : undefined) ?? pickStringHttp(copilotToken, [['sku']])

  const providerPayload = mergePayload(profilePayload, {
    github_login: githubUser !== undefined ? pickStringHttp(githubUser, [['login']]) ?? null : null,
    github_id: githubUser !== undefined ? getPathValue(githubUser, ['id']) ?? null : null,
    github_name: githubUser !== undefined ? pickStringHttp(githubUser, [['name']]) ?? null : null,
    github_email: githubUser !== undefined ? pickStringHttp(githubUser, [['email']]) ?? null : null,
    copilot_plan: plan ?? null,
    planName: plan ?? null,
    copilot_chat_enabled: getPathValue(copilotToken, ['chat_enabled']) ?? null,
    copilot_quota_snapshots:
      copilotUser !== undefined ? getPathValue(copilotUser, ['quota_snapshots']) ?? null : null,
    copilot_quota_reset_date:
      copilotUser !== undefined ? getPathValue(copilotUser, ['quota_reset_date']) ?? null : null,
    copilot_limited_user_quotas: getPathValue(copilotToken, ['limited_user_quotas']) ?? null,
    copilot_limited_user_reset_date:
      getPathValue(copilotToken, ['limited_user_reset_date']) ?? null,
    github_user_raw: githubUser ?? null,
    copilot_token_raw: copilotToken,
    copilot_user_raw: copilotUser ?? null,
  })

  return successResult('github_copilot', credential, providerPayload, undefined)
}

async function getGithubJson(url: string, token: string, bearer: boolean): Promise<JsonValue> {
  const auth = bearer ? `Bearer ${token}` : `token ${token}`
  const response = await httpFetch(
    url,
    {
      method: 'GET',
      headers: {
        'User-Agent': 'haoxiaoguan',
        Accept: 'application/json',
        'X-GitHub-Api-Version': '2025-04-01',
        Authorization: auth,
      },
    },
    '请求 GitHub Copilot 接口失败',
  )
  if (!response.ok) throw providerError(`GitHub Copilot 接口返回异常: status=${response.status}`)
  return parseJson(response, '解析 GitHub Copilot 响应失败')
}
