import { randomUUID } from 'node:crypto'
import type { PlatformId } from '../../contexts/account/domain/platform-id'
import type { Credential } from '../../contexts/account/domain/credential'
import type { JsonValue } from '../../contexts/account/domain/platform-account-profile'
import type { CredentialInjectionPort } from '../../contexts/account/domain/ports'
import { stateVscdbPath } from '../../contexts/credential/infrastructure/scan-helpers'
import {
  readVscdbPlain,
  writeVscdbItems,
  type VscdbPlainReader,
  type VscdbWriter,
} from './vscdb-secret-writer'

// Windsurf 专用切换注入（对照 cockpit-tools windsurf_instance::inject_account_to_profile
// + write_windsurf_auth_data）。
//
// Windsurf 的登录态分散在 state.vscdb 多个键，且部分是加密 SecretStorage：
//   windsurfAuthStatus                （明文 JSON：status=SignedIn + apiKey + user{name,email} + apiServerUrl）
//   secret://{codeium.windsurf, windsurf_auth.sessions}    （加密：sessions 数组）
//   secret://{codeium.windsurf, windsurf_auth.apiServerUrl}（加密：apiServerUrl 字符串）
//   codeium.windsurf-windsurf_auth     （明文：选中账号 label）
//   codeium.windsurf                   （明文 JSON：扩展态，必须含 codeium.installationId）
//   windsurfOnboarding                 （明文 JSON：completed）
//   删除 windsurf_auth-* 旧键，写 windsurf_auth-{label} / -usages
//
// 关键：codeium.installationId 必须保留（换值会被反作弊当成新机器登录）——读现值，
// 缺失才生成。此前通用 storage.serviceMachineId 注入对 Windsurf 完全无效。

const AUTH_STATUS_KEY = 'windsurfAuthStatus'
const SESSIONS_SECRET_KEY = 'secret://{"extensionId":"codeium.windsurf","key":"windsurf_auth.sessions"}'
const API_SERVER_SECRET_KEY = 'secret://{"extensionId":"codeium.windsurf","key":"windsurf_auth.apiServerUrl"}'
const SELECTED_AUTH_KEY = 'codeium.windsurf-windsurf_auth'
const EXTENSION_STATE_KEY = 'codeium.windsurf'
const DEFAULT_API_SERVER_URL = 'https://server.codeium.com'

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

export class WindsurfCredentialInjectionPort implements CredentialInjectionPort {
  private readonly stateDbPath: string

  constructor(
    stateDbPath?: string,
    private readonly writer: VscdbWriter = writeVscdbItems,
    private readonly readPlain: VscdbPlainReader = readVscdbPlain,
  ) {
    this.stateDbPath = stateDbPath ?? stateVscdbPath('Windsurf')
  }

  async inject(_platform: PlatformId, credential: Credential): Promise<void> {
    const meta = asObject(credential.rawMetadata)
    const accessToken = credential.token.trim()
    const apiKey = str(meta, ['windsurf_api_key', 'windsurfApiKey']) ?? accessToken
    if (apiKey.length === 0) {
      throw new Error('Windsurf 切换失败：缺少 apiKey/token')
    }
    const apiServerUrl =
      str(meta, ['windsurf_api_server_url', 'windsurfApiServerUrl']) ?? DEFAULT_API_SERVER_URL
    const email = str(meta, ['github_email', 'email'])
    const name = str(meta, ['github_name', 'name']) ?? str(meta, ['github_login']) ?? email ?? 'windsurf_user'
    const label = str(meta, ['github_login', 'githubLogin']) ?? email ?? name

    // windsurfAuthStatus：以导入保存的 raw 为骨架，补 SignedIn / apiKey / user。
    const authStatus: Record<string, JsonValue> = { ...(asObject(meta?.windsurf_auth_status_raw) ?? {}) }
    authStatus.apiKey = apiKey
    authStatus.name = name
    if (email) authStatus.email = email
    authStatus.apiServerUrl = apiServerUrl
    authStatus.status = 'SignedIn'
    authStatus.user = { name, email: email ?? null }
    authStatus.timestamp = Date.now()

    const sessions = [
      { id: randomUUID(), accessToken, account: { label, id: label }, scopes: [] },
    ]

    const extensionState = this.buildExtensionState(apiServerUrl)
    const onboarding = { completed: true, version: 1, timestamp: Date.now() }
    const usages = [
      { extensionId: 'codeium.windsurf', extensionName: 'Windsurf', scopes: [], lastUsed: Date.now() },
    ]

    await this.writer(this.stateDbPath, 'windsurf', {
      secrets: [
        { key: SESSIONS_SECRET_KEY, plaintext: JSON.stringify(sessions) },
        { key: API_SERVER_SECRET_KEY, plaintext: apiServerUrl },
      ],
      plain: [
        { key: AUTH_STATUS_KEY, value: JSON.stringify(authStatus) },
        { key: SELECTED_AUTH_KEY, value: label },
        { key: EXTENSION_STATE_KEY, value: JSON.stringify(extensionState) },
        { key: 'windsurfOnboarding', value: JSON.stringify(onboarding) },
        { key: `windsurf_auth-${label}`, value: '[]' },
        { key: `windsurf_auth-${label}-usages`, value: JSON.stringify(usages) },
      ],
      // 旧的 windsurf_auth-* 键无法用 LIKE 通配删除（writer 按精确 key），
      // 至少覆盖当前 label 的键；历史残留 label 不影响新账号登录判定。
    })
  }

  // codeium.installationId 必须稳定：读现值保留，缺失才生成新的。
  private buildExtensionState(apiServerUrl: string): Record<string, JsonValue> {
    const existing = this.readExtensionState()
    const state: Record<string, JsonValue> = { ...existing }
    const installationId = str(existing, ['codeium.installationId'])
    state['codeium.installationId'] = installationId ?? randomUUID()
    state['codeium.windsurf.apiServerUrl'] = apiServerUrl
    return state
  }

  private readExtensionState(): Record<string, JsonValue> {
    const raw = this.readPlain(this.stateDbPath, EXTENSION_STATE_KEY)
    if (raw === undefined) return {}
    try {
      const parsed = JSON.parse(raw) as unknown
      return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, JsonValue>)
        : {}
    } catch {
      return {}
    }
  }
}
