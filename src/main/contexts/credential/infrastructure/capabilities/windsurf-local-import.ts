import type { JsonValue } from '../../../account/domain/platform-account-profile'
import type { PlatformId } from '../../../account/domain/platform-id'
import type { LocalImportCapability } from '../../domain/capabilities'
import type { ImportedCredentialMaterial } from '../../domain/capability-types'
import { pickString, stateVscdbPath } from '../scan-helpers'
import { readVscdbItem, readVscdbKeyLike } from '../vscdb-reader'

// Windsurf local-scan capability. Windsurf's readable login state is the PLAIN
// (non-secret) state.vscdb key `windsurfAuthStatus`:
//   { status:"SignedIn", apiKey, name, email?, apiServerUrl, ... }
// plus a login hint from the first `windsurf_auth-<login>` key name. Mirrors
// cockpit-tools windsurf_account::read_local_auth_status/read_local_login_hint
// (the reference identifies the current account by apiKey/email/login-hint from
// these same keys). The encrypted windsurf_auth.sessions secret is NOT needed
// for import — apiKey is the credential Windsurf actually uses.
//
// rawMetadata mirrors the windsurf OAuth capability / profile / injection shape
// (windsurf_api_key / windsurf_api_server_url / windsurf_auth_status_raw +
// github_login/github_email/github_name), so switch write-back is symmetric.

const AUTH_STATUS_KEY = 'windsurfAuthStatus'
const LOGIN_HINT_PREFIX = 'windsurf_auth-'

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

export class WindsurfLocalImportCapability implements LocalImportCapability {
  constructor(private readonly stateDbPathOverride?: string) {}

  provider(): PlatformId {
    return 'windsurf'
  }

  private dbPath(): string {
    return this.stateDbPathOverride ?? stateVscdbPath('Windsurf')
  }

  async scanLocal(): Promise<ImportedCredentialMaterial[]> {
    const dbPath = this.dbPath()
    const rawValue = readVscdbItem(dbPath, AUTH_STATUS_KEY)
    if (!rawValue) return []

    let authStatus: Record<string, unknown> | undefined
    try {
      authStatus = asObject(JSON.parse(rawValue))
    } catch {
      return []
    }
    if (authStatus === undefined) return []

    const apiKey = pickString(authStatus, [['apiKey'], ['api_key']])
    if (!apiKey) return []

    const loginHintKey = readVscdbKeyLike(dbPath, `${LOGIN_HINT_PREFIX}%`)
    const loginHint =
      loginHintKey !== null && loginHintKey.startsWith(LOGIN_HINT_PREFIX)
        ? loginHintKey.slice(LOGIN_HINT_PREFIX.length).trim() || undefined
        : undefined

    const statusEmail = pickString(authStatus, [['email'], ['user', 'email']])
    const name = pickString(authStatus, [['name'], ['user', 'name']])
    const apiServerUrl = pickString(authStatus, [['apiServerUrl'], ['api_server_url']])
    const email = statusEmail ?? loginHint ?? name ?? 'windsurf-local'

    const rawMetadata: JsonValue = {
      email,
      github_login: loginHint ?? null,
      github_email: statusEmail ?? null,
      github_name: name ?? null,
      windsurf_api_key: apiKey,
      windsurf_api_server_url: apiServerUrl ?? null,
      windsurf_auth_status_raw: authStatus as JsonValue,
    }

    return [
      {
        provider: 'windsurf',
        email,
        accessToken: apiKey,
        refreshToken: undefined,
        expiresAt: undefined,
        source: 'local_scan',
        rawMetadata,
      },
    ]
  }
}
