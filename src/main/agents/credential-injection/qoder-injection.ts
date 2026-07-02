import type { PlatformId } from '../../contexts/account/domain/platform-id'
import type { Credential } from '../../contexts/account/domain/credential'
import type { JsonValue } from '../../contexts/account/domain/platform-account-profile'
import type { CredentialInjectionPort } from '../../contexts/account/domain/ports'
import { stateVscdbPath } from '../../contexts/credential/infrastructure/scan-helpers'
import { writeVscdbItems, type VscdbWriter } from './vscdb-secret-writer'

// Qoder 专用切换注入（对照 cockpit-tools qoder_account::inject_to_qoder_at_path）。
//
// Qoder 的登录态是 state.vscdb 里 3 个**加密 SecretStorage** 项：
//   secret://aicoding.auth.userInfo / userPlan / creditUsage
// 分别对应导入时保存的 auth_user_info_raw / auth_user_plan_raw / auth_credit_usage_raw。
// 通用 {"token"} 注入对它无效。这里把三份 raw 快照按 Qoder SafeStorage 模式加密写回；
// userInfo 缺失时用凭据兜底组装最小结构（保证含 token）。

const KEY_USER_INFO = 'secret://aicoding.auth.userInfo'
const KEY_USER_PLAN = 'secret://aicoding.auth.userPlan'
const KEY_CREDIT_USAGE = 'secret://aicoding.auth.creditUsage'

function asObject(value: JsonValue | undefined): Record<string, JsonValue> | undefined {
  return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, JsonValue>)
    : undefined
}

export class QoderCredentialInjectionPort implements CredentialInjectionPort {
  private readonly stateDbPath: string

  constructor(
    stateDbPath?: string,
    private readonly writer: VscdbWriter = writeVscdbItems,
  ) {
    this.stateDbPath = stateDbPath ?? stateVscdbPath('Qoder')
  }

  async inject(_platform: PlatformId, credential: Credential): Promise<void> {
    const accessToken = credential.token.trim()
    if (accessToken.length === 0) {
      throw new Error('Qoder 切换失败：token 为空')
    }
    const meta = asObject(credential.rawMetadata)

    const userInfo = asObject(meta?.auth_user_info_raw) ?? this.buildUserInfoFallback(credential, meta)
    // token 必须在 userInfo 里（Qoder 从这里取访问令牌）。
    if (typeof userInfo.token !== 'string' || userInfo.token.trim().length === 0) {
      userInfo.token = accessToken
    }
    const userPlan = asObject(meta?.auth_user_plan_raw)
    const creditUsage = asObject(meta?.auth_credit_usage_raw)

    const secrets = [{ key: KEY_USER_INFO, plaintext: JSON.stringify(userInfo) }]
    if (userPlan !== undefined) secrets.push({ key: KEY_USER_PLAN, plaintext: JSON.stringify(userPlan) })
    if (creditUsage !== undefined) {
      secrets.push({ key: KEY_CREDIT_USAGE, plaintext: JSON.stringify(creditUsage) })
    }

    await this.writer(this.stateDbPath, 'qoder', { secrets })
  }

  private buildUserInfoFallback(
    credential: Credential,
    meta: Record<string, JsonValue> | undefined,
  ): Record<string, JsonValue> {
    const info: Record<string, JsonValue> = { token: credential.token.trim() }
    const email = meta?.email
    if (typeof email === 'string') info.email = email
    const userId = meta?.user_id ?? meta?.userId
    if (typeof userId === 'string') info.id = userId
    if (credential.refreshToken) info.refreshToken = credential.refreshToken
    return info
  }
}
