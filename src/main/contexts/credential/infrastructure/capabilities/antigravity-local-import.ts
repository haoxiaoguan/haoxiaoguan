import type { JsonValue } from '../../../account/domain/platform-account-profile'
import type { PlatformId } from '../../../account/domain/platform-id'
import type { LocalImportCapability } from '../../domain/capabilities'
import type { ImportedCredentialMaterial } from '../../domain/capability-types'
import { parseOAuthTokenInfo, parseUserStatus } from '../antigravity-protobuf'
import { stateVscdbPath } from '../scan-helpers'
import { readVscdbItem } from '../vscdb-reader'
import {
  parseAntigravitySystemCredentialSecret,
  readAntigravityKeychainSecret,
  resolveAntigravitySystemCredential,
  type ResolveSystemCredentialOpts,
} from './antigravity-system-credential'

// Antigravity local-scan capability. Two very different storage shapes share
// this one class, picked by `platform`:
//   antigravity_ide → always state.vscdb PLAIN keys (base64 protobuf):
//     antigravityUnifiedStateSync.oauthToken → OAuthTokenInfo (access/refresh/expiry)
//     antigravityUnifiedStateSync.userStatus → UserStatus (email/name/plan)
//     Mirrors cockpit-tools protobuf::extract_refresh_token_from_unified_oauth_token
//     (extended here to also read access token / expiry / identity).
//   antigravity (legacy, non-IDE) → desktop client >= 2.0 moved login off
//     state.vscdb onto the OS credential store (macOS Keychain; see
//     antigravity-system-credential.ts and cockpit-tools
//     antigravity_legacy_instance::AntigravityDesktopAuthMode). We probe the
//     Keychain first and only fall back to the state.vscdb parse below when
//     it's absent/unresolvable — i.e. pre-2.0 installs, or platforms without
//     this Keychain entry. rawMetadata matches the antigravity profile
//     derivation (auth_id / antigravity_oauth_raw / antigravity_user_raw /
//     selected_auth_type=google + plan_name/tier_id) and the antigravity
//     switch injection shape either way, so import → display → switch stay symmetric.

const OAUTH_TOKEN_KEY = 'antigravityUnifiedStateSync.oauthToken'
const USER_STATUS_KEY = 'antigravityUnifiedStateSync.userStatus'

type AntigravityPlatform = 'antigravity' | 'antigravity_ide'

// antigravity → legacy "Antigravity"；antigravity_ide → 新版默认 "Antigravity IDE"
// （对照 antigravity_paths.rs default_user_data_dir / legacy_default_user_data_dir）。
function appDirFor(platform: AntigravityPlatform): string {
  return platform === 'antigravity_ide' ? 'Antigravity IDE' : 'Antigravity'
}

export interface AntigravityLocalImportOverrides {
  readKeychainSecret?: () => Promise<string | undefined>
  systemCredentialOpts?: ResolveSystemCredentialOpts
}

export class AntigravityLocalImportCapability implements LocalImportCapability {
  constructor(
    private readonly platform: AntigravityPlatform = 'antigravity_ide',
    private readonly stateDbPathOverride?: string,
    private readonly overrides?: AntigravityLocalImportOverrides,
  ) {}

  provider(): PlatformId {
    return this.platform
  }

  private dbPath(): string {
    return this.stateDbPathOverride ?? stateVscdbPath(appDirFor(this.platform))
  }

  async scanLocal(): Promise<ImportedCredentialMaterial[]> {
    if (this.platform === 'antigravity') {
      const viaSystemCredential = await this.scanSystemCredential()
      if (viaSystemCredential) return [viaSystemCredential]
    }
    return this.scanStateDb()
  }

  /** Legacy client >= 2.0: Keychain token, live-resolved via Google userinfo. */
  private async scanSystemCredential(): Promise<ImportedCredentialMaterial | undefined> {
    const readSecret = this.overrides?.readKeychainSecret ?? readAntigravityKeychainSecret
    const secret = await readSecret()
    if (!secret) return undefined
    const credential = parseAntigravitySystemCredentialSecret(secret)
    if (!credential) return undefined
    return resolveAntigravitySystemCredential(credential, this.overrides?.systemCredentialOpts)
  }

  /** antigravity_ide always, and antigravity pre-2.0 / when Keychain is unavailable. */
  private async scanStateDb(): Promise<ImportedCredentialMaterial[]> {
    const dbPath = this.dbPath()
    const oauthRaw = readVscdbItem(dbPath, OAUTH_TOKEN_KEY)
    if (!oauthRaw) return []

    let token: ReturnType<typeof parseOAuthTokenInfo>
    try {
      token = parseOAuthTokenInfo(Buffer.from(oauthRaw, 'base64'))
    } catch {
      return []
    }
    if (token === undefined || token.accessToken.length === 0) return []

    let userStatus: ReturnType<typeof parseUserStatus>
    const statusRaw = readVscdbItem(dbPath, USER_STATUS_KEY)
    if (statusRaw) {
      try {
        userStatus = parseUserStatus(Buffer.from(statusRaw, 'base64'))
      } catch {
        userStatus = undefined
      }
    }

    const email = userStatus?.email ?? 'antigravity-local'
    const expiresAt =
      token.expiryUnixSeconds !== undefined && token.expiryUnixSeconds > 0
        ? new Date(token.expiryUnixSeconds * 1000)
        : undefined

    const oauthRawMeta: Record<string, JsonValue> = {
      access_token: token.accessToken,
      token_type: token.tokenType ?? 'Bearer',
    }
    if (token.refreshToken) oauthRawMeta.refresh_token = token.refreshToken
    if (token.expiryUnixSeconds !== undefined) oauthRawMeta.expiry = token.expiryUnixSeconds

    const userRawMeta: Record<string, JsonValue> = { email }
    if (userStatus?.name) userRawMeta.name = userStatus.name

    const rawMetadata: JsonValue = {
      email,
      auth_id: null,
      selected_auth_type: 'google',
      oauth_client_key: 'antigravity_enterprise',
      plan_name: userStatus?.planName ?? null,
      tier_id: userStatus?.planTierId ?? null,
      antigravity_oauth_raw: oauthRawMeta,
      antigravity_user_raw: userRawMeta,
    }

    return [
      {
        provider: this.platform,
        email,
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
        expiresAt,
        source: 'local_scan',
        rawMetadata,
      },
    ]
  }
}
