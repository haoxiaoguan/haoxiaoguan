import type { JsonValue } from '../../../account/domain/platform-account-profile'
import type { PlatformId } from '../../../account/domain/platform-id'
import type { LocalImportCapability } from '../../domain/capabilities'
import type { ImportedCredentialMaterial } from '../../domain/capability-types'
import { jwtClaimString, parseExpiresAt, pickString, stateVscdbPath } from '../scan-helpers'
import { decodeSecretStorageValue, type SafeStorageMode } from '../vscode-secret-storage'
import { buildSecretStorageItemKey, normalizeNonEmpty, readVscdbItem } from '../vscdb-reader'

// Generic VSCode-family SecretStorage local-import capability. Mirrors the shared
// pattern used by the Rust VSCode-family local scanners (Windsurf, Kiro,
// Codebuddy, Qoder, Trae, Antigravity, GitHub Copilot): read a secret:// key from
// the app's state.vscdb, decrypt it via the SafeStorage AES-128-CBC path, then
// normalise the decrypted JSON token blob.
//
// Each provider supplies its app dir, extension id, secret key, and SafeStorage
// mode. The exact extension-id/key/auth-shape varies per provider in the source;
// this generic reader covers the common "decrypt secret → parse token JSON"
// path. Providers whose source scanner has bespoke multi-key logic are wired with
// the closest matching config and flagged in the manifest as // TODO(verify).

export interface VsCodeSecretScanConfig {
  platform: PlatformId
  appDir: string
  extensionId: string
  secretKey: string
  mode?: SafeStorageMode
  /** Optional plain (non-secret) ItemTable key holding the email/identifier. */
  emailItemKey?: string
}

export class VsCodeSecretLocalImportCapability implements LocalImportCapability {
  constructor(
    private readonly config: VsCodeSecretScanConfig,
    private readonly stateDbPathOverride?: string,
  ) {}

  provider(): PlatformId {
    return this.config.platform
  }

  private dbPath(): string {
    return this.stateDbPathOverride ?? stateVscdbPath(this.config.appDir)
  }

  async scanLocal(): Promise<ImportedCredentialMaterial[]> {
    const dbPath = this.dbPath()
    const secretItemKey = buildSecretStorageItemKey(this.config.extensionId, this.config.secretKey)
    const rawValue = readVscdbItem(dbPath, secretItemKey)
    if (!rawValue) return []

    const decoded = await decodeSecretStorageValue(rawValue, this.config.mode ?? 'default')
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(decoded) as Record<string, unknown>
    } catch {
      // The decrypted value may itself be a bare token string.
      const bare = normalizeNonEmpty(decoded)
      if (!bare) return []
      parsed = { access_token: bare }
    }

    const accessToken = pickString(parsed, [
      ['access_token'],
      ['accessToken'],
      ['token'],
      ['tokens', 'access_token'],
    ])
    if (!accessToken) return []
    const refreshToken = pickString(parsed, [['refresh_token'], ['refreshToken'], ['tokens', 'refresh_token']])

    const emailFromItem = this.config.emailItemKey
      ? normalizeNonEmpty(readVscdbItem(dbPath, this.config.emailItemKey))
      : undefined
    const email =
      emailFromItem ??
      pickString(parsed, [['email'], ['userEmail'], ['cachedEmail']]) ??
      jwtClaimString(accessToken, 'email') ??
      jwtClaimString(accessToken, 'sub') ??
      `${this.config.platform}-local`

    const expiresAt = parseExpiresAt(parsed.expires_at ?? parsed.expiresAt)

    return [
      {
        provider: this.config.platform,
        email,
        accessToken,
        refreshToken,
        expiresAt,
        source: 'local_scan',
        rawMetadata: parsed as JsonValue,
      },
    ]
  }
}
