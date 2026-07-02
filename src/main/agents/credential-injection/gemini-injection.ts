import { existsSync, readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { PlatformId } from '../../contexts/account/domain/platform-id'
import type { Credential } from '../../contexts/account/domain/credential'
import type { JsonValue } from '../../contexts/account/domain/platform-account-profile'
import type { CredentialInjectionPort } from '../../contexts/account/domain/ports'
import { atomicWrite } from '../../platform/fs/atomic-write'
import { dotDir } from '../../platform/persistence/paths'
import { createKeychainCommandRunner, type KeychainCommandRunner } from './mac-keychain'

// Gemini CLI 专用切换注入（对照 cockpit-tools gemini_account.rs 的
// write_local_oauth_creds_to_path + write_local_google_accounts + settings.json
// selectedType + write_local_oauth_creds_to_keychain + clear file-keychain）。
//
// Gemini CLI 真实登录态分散在 ~/.gemini 下多文件，且 macOS 默认从 keychain
// (service=gemini-cli-oauth, account=main-account) 读取 —— 只写 {"token"} 无效。
// 这里整写：
//   oauth_creds.json     access_token/refresh_token/id_token/token_type/scope/expiry_date
//   google_accounts.json active email + old 列表
//   settings.json        security.auth.selectedType = "oauth-personal"
//   macOS Keychain       service=gemini-cli-oauth, account=main-account（JSON）
//   删除 gemini-credentials.json（避免 file-keychain 与真 keychain 冲突）

const GEMINI_KEYCHAIN_SERVICE = 'gemini-cli-oauth'
const GEMINI_KEYCHAIN_ACCOUNT = 'main-account'

interface GeminiAuthFields {
  accessToken: string
  refreshToken?: string | undefined
  idToken?: string | undefined
  tokenType?: string | undefined
  scope?: string | undefined
  expiryDate?: number | undefined
  email?: string | undefined
}

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

function num(obj: Record<string, JsonValue> | undefined, keys: string[]): number | undefined {
  if (!obj) return undefined
  for (const key of keys) {
    const v = obj[key]
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (typeof v === 'string') {
      const n = Number(v)
      if (Number.isFinite(n)) return n
    }
  }
  return undefined
}

function resolveFields(credential: Credential): GeminiAuthFields {
  const meta = asObject(credential.rawMetadata)
  const authRaw = asObject(meta?.gemini_auth_raw)
  const accessToken = (str(authRaw, ['access_token', 'accessToken']) ?? credential.token).trim()
  return {
    accessToken,
    refreshToken: str(authRaw, ['refresh_token', 'refreshToken']) ?? credential.refreshToken,
    idToken: str(authRaw, ['id_token', 'idToken']),
    tokenType: str(authRaw, ['token_type', 'tokenType']) ?? 'Bearer',
    scope: str(authRaw, ['scope']),
    expiryDate:
      num(authRaw, ['expiry_date', 'expiryDate']) ??
      (credential.expiresAt ? credential.expiresAt.getTime() : undefined),
    email: str(meta, ['email']) ?? str(authRaw, ['email']),
  }
}

export class GeminiCredentialInjectionPort implements CredentialInjectionPort {
  private readonly homeDir: string
  private readonly keychain: KeychainCommandRunner

  constructor(homeDir: string = dotDir('gemini'), keychain?: KeychainCommandRunner) {
    this.homeDir = homeDir
    this.keychain = keychain ?? createKeychainCommandRunner()
  }

  async inject(_platform: PlatformId, credential: Credential): Promise<void> {
    const fields = resolveFields(credential)
    if (fields.accessToken.length === 0) {
      throw new Error('Gemini 切换失败：access_token 为空')
    }

    await this.writeOauthCreds(fields)
    await this.writeGoogleAccounts(fields.email)
    await this.writeSelectedAuthType()
    await this.clearFileKeychain()
    await this.writeKeychain(fields)
  }

  private oauthCredsPath(): string {
    return join(this.homeDir, 'oauth_creds.json')
  }

  private async writeOauthCreds(fields: GeminiAuthFields): Promise<void> {
    const payload: Record<string, JsonValue> = { access_token: fields.accessToken }
    if (fields.refreshToken) payload.refresh_token = fields.refreshToken
    if (fields.idToken) payload.id_token = fields.idToken
    if (fields.tokenType) payload.token_type = fields.tokenType
    if (fields.scope) payload.scope = fields.scope
    if (fields.expiryDate !== undefined) payload.expiry_date = fields.expiryDate
    await atomicWrite(this.oauthCredsPath(), JSON.stringify(payload, null, 2))
  }

  // active email + old 列表（把上一 active 挪进 old，去重）。
  private async writeGoogleAccounts(email: string | undefined): Promise<void> {
    const path = join(this.homeDir, 'google_accounts.json')
    const existing = readJsonObject(path)
    const prevActive = str(existing, ['active'])
    const oldRaw = existing?.old
    const old = new Set<string>(
      Array.isArray(oldRaw) ? oldRaw.filter((v): v is string => typeof v === 'string') : [],
    )
    if (prevActive && prevActive !== email) old.add(prevActive)
    if (email) old.delete(email)
    const payload: Record<string, JsonValue> = { active: email ?? null, old: Array.from(old) }
    await atomicWrite(path, JSON.stringify(payload, null, 2))
  }

  // settings.json 里 merge security.auth.selectedType，保留其它设置。
  private async writeSelectedAuthType(): Promise<void> {
    const path = join(this.homeDir, 'settings.json')
    const root = readJsonObject(path) ?? {}
    const security = asObject(root.security as JsonValue) ?? {}
    const auth = asObject(security.auth as JsonValue) ?? {}
    auth.selectedType = 'oauth-personal'
    security.auth = auth as JsonValue
    root.security = security as JsonValue
    await atomicWrite(path, JSON.stringify(root, null, 2))
  }

  private async clearFileKeychain(): Promise<void> {
    const path = join(this.homeDir, 'gemini-credentials.json')
    if (existsSync(path)) await rm(path, { force: true }).catch(() => undefined)
  }

  private async writeKeychain(fields: GeminiAuthFields): Promise<void> {
    if (!this.keychain.available) return
    const token: Record<string, JsonValue> = {
      accessToken: fields.accessToken,
      tokenType: fields.tokenType ?? 'Bearer',
    }
    if (fields.refreshToken) token.refreshToken = fields.refreshToken
    if (fields.scope) token.scope = fields.scope
    if (fields.expiryDate !== undefined) token.expiresAt = fields.expiryDate
    const secret = JSON.stringify({
      serverName: GEMINI_KEYCHAIN_ACCOUNT,
      token,
      updatedAt: Date.now(),
    })
    try {
      await this.keychain.run([
        'add-generic-password',
        '-U',
        '-s',
        GEMINI_KEYCHAIN_SERVICE,
        '-a',
        GEMINI_KEYCHAIN_ACCOUNT,
        '-w',
        secret,
      ])
    } catch (e) {
      // 文件已写成，新版 Gemini 可能仍读旧 keychain —— 告警不阻断（与 codex 一致）。
      console.warn(
        `[gemini-switch] 写入 Gemini Keychain 失败（oauth_creds.json 已更新）: ${
          e instanceof Error ? e.message : String(e)
        }`,
      )
    }
  }
}

function readJsonObject(path: string): Record<string, JsonValue> | undefined {
  if (!existsSync(path)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, JsonValue>)
      : undefined
  } catch {
    return undefined
  }
}
