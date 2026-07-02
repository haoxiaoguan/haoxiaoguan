import { randomUUID } from 'node:crypto'
import type { PlatformId } from '../../contexts/account/domain/platform-id'
import type { Credential } from '../../contexts/account/domain/credential'
import type { JsonValue } from '../../contexts/account/domain/platform-account-profile'
import type { CredentialInjectionPort } from '../../contexts/account/domain/ports'
import { stateVscdbPath } from '../../contexts/credential/infrastructure/scan-helpers'
import { writeVscdbItems, type VscdbWriter } from './vscdb-secret-writer'

// GitHub Copilot 专用切换注入（对照 cockpit-tools vscode_inject::
// inject_copilot_token_for_user_data_dir）。
//
// VS Code 的 GitHub 登录态是 state.vscdb 里加密 SecretStorage 项
//   secret://{"extensionId":"vscode.github-authentication","key":"github.auth"}
// （SafeStorage 加密的 sessions 数组），配合明文 github.copilot-github /
// github.copilot-chat-github 账号偏好键与 github-<user>/-usages。切号时还清掉
// chat 语言模型缓存，避免旧账号模型残留。此前写 hosts.json 对 VS Code 扩展无效。

const GITHUB_AUTH_SECRET_KEY =
  'secret://{"extensionId":"vscode.github-authentication","key":"github.auth"}'
const LOGIN_KEY = 'github.copilot-github'
const CHAT_ACCOUNT_PREFERENCE_KEY = 'github.copilot-chat-github'
const CHAT_EXTENSION_ID = 'github.copilot-chat'
const CHAT_EXTENSION_NAME = 'GitHub Copilot Chat'
const PROVIDER_ID = 'github'
const CACHE_KEYS_ON_SWITCH = ['chat.cachedLanguageModels', 'chat.cachedLanguageModels.v2']

// 与参考一致的三组 Copilot 会话 scope。
const SESSION_SCOPE_SETS: string[][] = [
  ['read:user', 'user:email', 'repo', 'workflow'],
  ['user:email'],
  ['read:user'],
]

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
    if (typeof v === 'number') return String(v)
  }
  return undefined
}

export class GitHubCopilotCredentialInjectionPort implements CredentialInjectionPort {
  private readonly stateDbPath: string

  constructor(
    stateDbPath?: string,
    private readonly writer: VscdbWriter = writeVscdbItems,
  ) {
    // VS Code 的用户数据目录（Code/User/globalStorage/state.vscdb）。
    this.stateDbPath = stateDbPath ?? stateVscdbPath('Code')
  }

  async inject(_platform: PlatformId, credential: Credential): Promise<void> {
    const token = credential.token.trim()
    if (token.length === 0) {
      throw new Error('GitHub Copilot 切换失败：token 为空')
    }
    const meta = asObject(credential.rawMetadata)
    const username =
      str(meta, ['github_login', 'githubLogin', 'login']) ?? str(meta, ['email']) ?? 'github-user'
    const userId = str(meta, ['github_id', 'githubId', 'id']) ?? '0'

    const sessions = SESSION_SCOPE_SETS.map((scopes) => ({
      id: randomUUID(),
      scopes,
      accessToken: token,
      account: { label: username, id: userId },
    }))

    const now = Date.now()
    const accessValue = JSON.stringify([
      { id: CHAT_EXTENSION_ID, name: CHAT_EXTENSION_NAME, allowed: true },
    ])
    const usageValue = JSON.stringify([
      {
        extensionId: CHAT_EXTENSION_ID,
        extensionName: CHAT_EXTENSION_NAME,
        scopes: SESSION_SCOPE_SETS[0],
        lastUsed: now,
      },
    ])

    await this.writer(this.stateDbPath, 'default', {
      secrets: [{ key: GITHUB_AUTH_SECRET_KEY, plaintext: JSON.stringify(sessions) }],
      plain: [
        { key: LOGIN_KEY, value: username },
        { key: CHAT_ACCOUNT_PREFERENCE_KEY, value: username },
        { key: `${PROVIDER_ID}-${username}`, value: accessValue },
        { key: `${PROVIDER_ID}-${username}-usages`, value: usageValue },
      ],
      deletes: [...CACHE_KEYS_ON_SWITCH],
    })
  }
}
