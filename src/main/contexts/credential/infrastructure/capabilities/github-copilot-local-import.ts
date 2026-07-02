import type { JsonValue } from '../../../account/domain/platform-account-profile'
import type { PlatformId } from '../../../account/domain/platform-id'
import type { LocalImportCapability } from '../../domain/capabilities'
import type { ImportedCredentialMaterial } from '../../domain/capability-types'
import { stateVscdbPath } from '../scan-helpers'
import { decodeSecretStorageValue } from '../vscode-secret-storage'
import { buildSecretStorageItemKey, normalizeNonEmpty, readVscdbItem } from '../vscdb-reader'

// GitHub Copilot local-scan capability. VS Code stores the GitHub login as an
// encrypted SecretStorage value in state.vscdb under
//   secret://{"extensionId":"vscode.github-authentication","key":"github.auth"}
// whose decrypted content is a JSON array of sessions
//   [{ id, scopes, accessToken, account:{label,id} }].
// We decrypt via the SafeStorage AES path, pick the Copilot session (widest
// scopes, else the first with a token), and normalise to the github_copilot
// profile shape (github_login/github_id + access token). Mirrors the inverse of
// github-copilot-injection.
//
// The generic VsCodeSecretLocalImportCapability can't parse this (the value is a
// sessions ARRAY, not a {access_token} object), so Copilot needs this reader.

const EXTENSION_ID = 'vscode.github-authentication'
const SECRET_KEY = 'github.auth'

interface GithubSession {
  scopes?: unknown
  accessToken?: unknown
  account?: { label?: unknown; id?: unknown }
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

export class GitHubCopilotLocalImportCapability implements LocalImportCapability {
  constructor(private readonly stateDbPathOverride?: string) {}

  provider(): PlatformId {
    return 'github_copilot'
  }

  private dbPath(): string {
    return this.stateDbPathOverride ?? stateVscdbPath('Code')
  }

  async scanLocal(): Promise<ImportedCredentialMaterial[]> {
    const secretItemKey = buildSecretStorageItemKey(EXTENSION_ID, SECRET_KEY)
    const rawValue = readVscdbItem(this.dbPath(), secretItemKey)
    if (!rawValue) return []

    let decoded: string
    try {
      decoded = await decodeSecretStorageValue(rawValue, 'default')
    } catch {
      return []
    }

    let sessions: GithubSession[]
    try {
      const parsed = JSON.parse(decoded) as unknown
      if (!Array.isArray(parsed)) return []
      sessions = parsed as GithubSession[]
    } catch {
      return []
    }

    const session = pickCopilotSession(sessions)
    if (session === undefined) return []
    const accessToken = str(session.accessToken)
    if (!accessToken) return []

    const login = str(session.account?.label)
    const githubId = str(session.account?.id)
    const email = login ?? `github-copilot-local`

    const rawMetadata: JsonValue = {
      email,
      github_login: login ?? null,
      github_id: githubId ?? null,
      access_token: accessToken,
      auth_mode: 'github_oauth',
      github_auth_sessions_raw: sessions as unknown as JsonValue,
    }

    return [
      {
        provider: 'github_copilot',
        email,
        accessToken,
        refreshToken: undefined,
        expiresAt: undefined,
        source: 'local_scan',
        rawMetadata,
      },
    ]
  }
}

// 选 Copilot 会话：优先 scope 最多且含 access token 的（Copilot 会话 scope 最全：
// read:user/user:email/repo/workflow），否则第一个有 accessToken 的。
function pickCopilotSession(sessions: GithubSession[]): GithubSession | undefined {
  const withToken = sessions.filter((s) => normalizeNonEmpty(str(s.accessToken)) !== undefined)
  if (withToken.length === 0) return undefined
  return withToken
    .slice()
    .sort((a, b) => scopeCount(b) - scopeCount(a))[0]
}

function scopeCount(session: GithubSession): number {
  return Array.isArray(session.scopes) ? session.scopes.length : 0
}
