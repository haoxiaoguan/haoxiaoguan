import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { PlatformId } from '../../contexts/account/domain/platform-id'
import type { Credential } from '../../contexts/account/domain/credential'
import type { JsonValue } from '../../contexts/account/domain/platform-account-profile'
import type { CredentialInjectionPort } from '../../contexts/account/domain/ports'
import { atomicWrite } from '../../platform/fs/atomic-write'
import { appSupportDir } from '../../platform/persistence/paths'

// Kiro 专用切换注入（对照 cockpit-tools kiro_instance::inject_account_to_profile：
// write_local_auth_token_file + write_profile_file）。
//
// Kiro 是 AWS SSO 后端，登录态在 PLAIN JSON 文件 ~/.aws/sso/cache/kiro-auth-token.json
// （accessToken/refreshToken/expiresAt/region/provider/clientIdHash…），不在
// storage.json 的 serviceMachineId。导入正是从这里读取，切号必须写回同一文件；
// 另把 profile.json 一并更新（IDE 侧展示镜像）。usage 遥测（state.vscdb 明文项）
// 非登录必需，这里不写。
//
// auth-token 文件以导入时保存的 kiro_auth_token_raw 为骨架（保留 region/provider/
// clientIdHash 等路由字段），再用当前凭据覆盖 accessToken/refreshToken/expiresAt，
// 避免丢失企业(IdC)路由信息。

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

export class KiroCredentialInjectionPort implements CredentialInjectionPort {
  private readonly authTokenPath: string
  private readonly profilePath: string

  constructor(authTokenPath?: string, profilePath?: string) {
    this.authTokenPath = authTokenPath ?? join(homedir(), '.aws', 'sso', 'cache', 'kiro-auth-token.json')
    this.profilePath =
      profilePath ?? join(appSupportDir('Kiro'), 'User', 'globalStorage', 'kiro.kiroagent', 'profile.json')
  }

  async inject(_platform: PlatformId, credential: Credential): Promise<void> {
    const accessToken = credential.token.trim()
    if (accessToken.length === 0) {
      throw new Error('Kiro 切换失败：accessToken 为空')
    }
    const meta = asObject(credential.rawMetadata)

    // 以导入时的原始 auth-token JSON 为骨架，保留 region/provider/clientId 等字段。
    const base = { ...(asObject(meta?.kiro_auth_token_raw) ?? {}) }
    base.accessToken = accessToken
    const refreshToken =
      credential.refreshToken ?? str(meta, ['refreshToken', 'refresh_token']) ?? str(base, ['refreshToken'])
    if (refreshToken !== undefined) base.refreshToken = refreshToken
    if (credential.expiresAt !== undefined) base.expiresAt = credential.expiresAt.toISOString()
    // region / profileArn 若骨架缺失、rawMetadata 有，则补上（企业账号路由必需）。
    const region = str(base, ['region']) ?? str(meta, ['region'])
    if (region !== undefined) base.region = region
    const profileArn = str(base, ['profileArn']) ?? str(meta, ['profileArn'])
    if (profileArn !== undefined) base.profileArn = profileArn

    await atomicWrite(this.authTokenPath, JSON.stringify(base, null, 2))

    // profile.json：有导入镜像就整写回；没有则跳过（不是登录必需）。
    const profileRaw = asObject(meta?.kiro_profile_raw)
    if (profileRaw !== undefined && existsSync(dirOf(this.profilePath))) {
      await atomicWrite(this.profilePath, JSON.stringify(profileRaw, null, 2))
    }
  }
}

function dirOf(path: string): string {
  const idx = path.lastIndexOf('/')
  return idx > 0 ? path.slice(0, idx) : path
}
