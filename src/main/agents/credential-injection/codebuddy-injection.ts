import { join } from 'node:path'
import type { PlatformId } from '../../contexts/account/domain/platform-id'
import type { Credential } from '../../contexts/account/domain/credential'
import type { JsonValue } from '../../contexts/account/domain/platform-account-profile'
import type { CredentialInjectionPort } from '../../contexts/account/domain/ports'
import { appSupportDir } from '../../platform/persistence/paths'
import { stateVscdbPath } from '../../contexts/credential/infrastructure/scan-helpers'
import type { SafeStorageMode } from '../../contexts/credential/infrastructure/vscode-secret-storage'
import { writeVscdbItems, type VscdbWriter } from './vscdb-secret-writer'

// CodeBuddy / CodeBuddy CN 专用切换注入（对照 cockpit-tools
// cockpit-codebuddy(-cn)-adapter::inject_account_to_state_db + build_session_json）。
//
// CodeBuddy 的登录态是 state.vscdb 里的**加密 SecretStorage** 项
//   secret://{"extensionId":"tencent-cloud.coding-copilot","key":"planning-genie.new.accessToken"}
// （CN 版 key 后缀为 accessTokencn），value 是 SafeStorage 加密的 session JSON。
// 通用 storage.serviceMachineId 注入对它完全无效。这里按官方 session 结构组装并加密写入。

const EXTENSION_ID = 'tencent-cloud.coding-copilot'
const SECRET_KEY_INTL = 'planning-genie.new.accessToken'
const SECRET_KEY_CN = 'planning-genie.new.accessTokencn'

function asObject(value: JsonValue | undefined): Record<string, JsonValue> | undefined {
  return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, JsonValue>)
    : undefined
}

function str(obj: Record<string, JsonValue> | undefined, keys: string[]): string {
  if (obj) {
    for (const key of keys) {
      const v = obj[key]
      if (typeof v === 'string' && v.trim().length > 0) return v.trim()
    }
  }
  return ''
}

function num(obj: Record<string, JsonValue> | undefined, keys: string[]): number {
  if (obj) {
    for (const key of keys) {
      const v = obj[key]
      if (typeof v === 'number' && Number.isFinite(v)) return v
    }
  }
  return 0
}

export class CodebuddyCredentialInjectionPort implements CredentialInjectionPort {
  private readonly stateDbPath: string
  private readonly secretKey: string
  private readonly mode: SafeStorageMode

  constructor(
    private readonly platform: 'codebuddy' | 'codebuddy_cn',
    stateDbPath?: string,
    private readonly writer: VscdbWriter = writeVscdbItems,
  ) {
    // CN 版数据目录带空格："CodeBuddy CN"（对照 get_default_codebuddy_cn_data_dir）。
    const appDir = platform === 'codebuddy_cn' ? 'CodeBuddy CN' : 'CodeBuddy'
    this.stateDbPath = stateDbPath ?? stateVscdbPath(appDir)
    this.secretKey = platform === 'codebuddy_cn' ? SECRET_KEY_CN : SECRET_KEY_INTL
    this.mode = platform === 'codebuddy_cn' ? 'codebuddy_cn' : 'codebuddy'
  }

  async inject(_platform: PlatformId, credential: Credential): Promise<void> {
    const accessToken = credential.token.trim()
    if (accessToken.length === 0) {
      throw new Error(`${this.platform} 切换失败：accessToken 为空`)
    }
    const meta = asObject(credential.rawMetadata)
    const session = this.buildSessionJson(credential, meta)
    const dbKey = `secret://{"extensionId":"${EXTENSION_ID}","key":"${this.secretKey}"}`

    await this.writer(this.stateDbPath, this.mode, {
      secrets: [{ key: dbKey, plaintext: session }],
    })
  }

  private buildSessionJson(credential: Credential, meta: Record<string, JsonValue> | undefined): string {
    const accessToken = credential.token.trim()
    const uid = str(meta, ['uid'])
    const nickname = str(meta, ['nickname'])
    const enterpriseId = str(meta, ['enterprise_id', 'enterpriseId'])
    const enterpriseName = str(meta, ['enterprise_name', 'enterpriseName'])
    const domain = str(meta, ['domain'])
    const refreshToken = credential.refreshToken ?? str(meta, ['refresh_token', 'refreshToken'])
    const tokenType = str(meta, ['token_type', 'tokenType']) || 'Bearer'
    const expiresAt = num(meta, ['expires_at', 'expiresAt'])
    const now = Date.now()

    const session: Record<string, JsonValue> = {
      id: 'Tencent-Cloud.genie-ide',
      token: accessToken,
      refreshToken,
      expiresAt,
      domain,
      accessToken: `${uid}+${accessToken}`,
      converted: true,
      account: {
        id: uid,
        uid,
        label: nickname,
        nickname,
        enterpriseId,
        enterpriseName,
        pluginEnabled: true,
        lastLogin: true,
      },
      auth: {
        accessToken,
        refreshToken,
        tokenType,
        domain,
        expiresAt,
        expiresIn: expiresAt,
        refreshExpiresIn: 0,
        refreshExpiresAt: 0,
        lastRefreshTime: now,
      },
    }
    return JSON.stringify(session)
  }
}

/** Default CodeBuddy state.vscdb path (exported for symmetry/tests). */
export function defaultCodebuddyStateDb(platform: 'codebuddy' | 'codebuddy_cn'): string {
  const appDir = platform === 'codebuddy_cn' ? 'CodeBuddy CN' : 'CodeBuddy'
  return join(appSupportDir(appDir), 'User', 'globalStorage', 'state.vscdb')
}
