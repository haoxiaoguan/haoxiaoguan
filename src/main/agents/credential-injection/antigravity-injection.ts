import type { PlatformId } from '../../contexts/account/domain/platform-id'
import type { Credential } from '../../contexts/account/domain/credential'
import type { JsonValue } from '../../contexts/account/domain/platform-account-profile'
import type { CredentialInjectionPort } from '../../contexts/account/domain/ports'
import { stateVscdbPath } from '../../contexts/credential/infrastructure/scan-helpers'
import {
  createOAuthInfo,
  createUnifiedTopicEntry,
  createMinimalUserStatusPayload,
  removeUnifiedTopicEntry,
} from '../../contexts/credential/infrastructure/antigravity-protobuf'
import {
  readVscdbPlain,
  writeVscdbItems,
  type VscdbPlainReader,
  type VscdbWriter,
} from './vscdb-secret-writer'

// Antigravity / Antigravity IDE 专用切换注入（对照 cockpit-tools db.rs
// inject_unified_oauth_token + inject_user_status + onboarding）。
//
// Antigravity 的登录态是 state.vscdb 里的**明文 base64 protobuf**：
//   antigravityUnifiedStateSync.oauthToken  → Topic{ oauthTokenInfoSentinelKey:
//                                              OAuthTokenInfo(access/type/refresh/expiry) }
//   antigravityUnifiedStateSync.userStatus  → Topic{ userStatusSentinelKey: {email} }
//   antigravityOnboarding = "true"
// 注入时：读旧 oauthToken topic → 删掉旧的 oauthTokenInfoSentinelKey 行 → 追加新
// 行（保留同 topic 下其它 sentinel）；userStatus 重写为最小 {email}（客户端启动会
// 从服务端重新同步）；置 onboarding=true 并清掉 jetski 初始化态。
//
// 两个发行版目录不同：antigravity → "Antigravity"（legacy），antigravity_ide →
// "Antigravity IDE"（当前默认）。

const OAUTH_TOKEN_KEY = 'antigravityUnifiedStateSync.oauthToken'
const USER_STATUS_KEY = 'antigravityUnifiedStateSync.userStatus'
const ONBOARDING_KEY = 'antigravityOnboarding'
const JETSKI_INIT_KEY = 'jetskiStateSync.agentManagerInitState'

function asObject(value: JsonValue | undefined): Record<string, JsonValue> | undefined {
  return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, JsonValue>)
    : undefined
}

function str(obj: Record<string, JsonValue> | undefined, keys: string[]): string | undefined {
  if (!obj) return undefined
  for (const key of keys) {
    const v = obj[key]
    if (typeof v === 'string' && v.trim().length > 0) return v.trim()
  }
  return undefined
}

export function antigravityAppDir(platform: 'antigravity' | 'antigravity_ide'): string {
  return platform === 'antigravity_ide' ? 'Antigravity IDE' : 'Antigravity'
}

export class AntigravityCredentialInjectionPort implements CredentialInjectionPort {
  private readonly stateDbPath: string

  constructor(
    private readonly platform: 'antigravity' | 'antigravity_ide',
    stateDbPath?: string,
    private readonly writer: VscdbWriter = writeVscdbItems,
    private readonly readPlain: VscdbPlainReader = readVscdbPlain,
  ) {
    this.stateDbPath = stateDbPath ?? stateVscdbPath(antigravityAppDir(platform))
  }

  async inject(_platform: PlatformId, credential: Credential): Promise<void> {
    const accessToken = credential.token.trim()
    if (accessToken.length === 0) {
      throw new Error(`${this.platform} 切换失败：access token 为空`)
    }
    const meta = asObject(credential.rawMetadata)
    const oauthRaw = asObject(meta?.antigravity_oauth_raw)
    const userRaw = asObject(meta?.antigravity_user_raw)

    const refreshToken =
      credential.refreshToken ?? str(oauthRaw, ['refresh_token', 'refreshToken']) ?? ''
    const idToken = str(oauthRaw, ['id_token', 'idToken'])
    const email = str(meta, ['email']) ?? str(userRaw, ['email']) ?? ''
    const expirySeconds = this.resolveExpirySeconds(credential, oauthRaw)

    // oauthToken：保留同 topic 下其它 sentinel，替换 oauthTokenInfoSentinelKey。
    const existingB64 = this.readPlain(this.stateDbPath, OAUTH_TOKEN_KEY)
    let base: Buffer = Buffer.from([])
    if (existingB64 !== undefined) {
      try {
        base = removeUnifiedTopicEntry(Buffer.from(existingB64.trim(), 'base64'), 'oauthTokenInfoSentinelKey')
      } catch {
        base = Buffer.from([])
      }
    }
    const oauthInfo = createOAuthInfo(accessToken, refreshToken, expirySeconds, idToken)
    const topic = Buffer.concat([base, createUnifiedTopicEntry('oauthTokenInfoSentinelKey', oauthInfo)])

    const plain: Array<{ key: string; value: string }> = [
      { key: OAUTH_TOKEN_KEY, value: topic.toString('base64') },
      { key: ONBOARDING_KEY, value: 'true' },
    ]
    if (email.length > 0) {
      const status = createUnifiedTopicEntry('userStatusSentinelKey', createMinimalUserStatusPayload(email))
      plain.push({ key: USER_STATUS_KEY, value: status.toString('base64') })
    }

    await this.writer(this.stateDbPath, 'default', { plain, deletes: [JETSKI_INIT_KEY] })
  }

  private resolveExpirySeconds(
    credential: Credential,
    oauthRaw: Record<string, JsonValue> | undefined,
  ): number {
    if (credential.expiresAt !== undefined) return Math.floor(credential.expiresAt.getTime() / 1000)
    const raw = oauthRaw?.expiry ?? oauthRaw?.expiry_date
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return raw > 10_000_000_000 ? Math.floor(raw / 1000) : raw
    }
    return 0
  }
}
