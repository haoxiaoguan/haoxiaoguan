import type { JsonValue } from '../../../account/domain/platform-account-profile'
import type { PlatformId } from '../../../account/domain/platform-id'
import type { FileImportCapability } from '../../domain/capabilities'
import type { ImportedCredentialMaterial } from '../../domain/capability-types'
import { CredentialError } from '../../domain/credential-error'
import { jwtClaimString, parseExpiresAt, pickString } from '../scan-helpers'

// Generic token-JSON file-import capability. The source registers file-import as
// a per-provider stub (UnsupportedSource), but the IPC channel + frontend
// contract (import_token_json) are real, so this provides a portable normaliser:
// it parses pasted token JSON into ImportedCredentialMaterial, accepting the
// common field spellings (access_token/accessToken/token, refresh_token, email,
// expires_at) and falling back to a JWT `sub`/`email` claim for the identifier.
//
// Construct one per provider so the registry can key it by PlatformId.

export class TokenJsonFileImportCapability implements FileImportCapability {
  constructor(private readonly platform: PlatformId) {}

  provider(): PlatformId {
    return this.platform
  }

  async importFromJson(payload: string): Promise<ImportedCredentialMaterial> {
    let parsed: unknown
    try {
      parsed = JSON.parse(payload)
    } catch (e) {
      throw CredentialError.malformedInput(
        `payload (not valid JSON: ${e instanceof Error ? e.message : String(e)})`,
      )
    }
    if (parsed === null || typeof parsed !== 'object') {
      throw CredentialError.malformedInput('payload (expected a JSON object)')
    }
    const obj = parsed as Record<string, unknown>

    const accessToken = pickString(obj, [
      ['access_token'],
      ['accessToken'],
      ['token'],
      ['tokens', 'access_token'],
      ['tokens', 'accessToken'],
    ])
    if (!accessToken) {
      throw CredentialError.invalidCredential('missing access_token')
    }
    const refreshToken = pickString(obj, [
      ['refresh_token'],
      ['refreshToken'],
      ['tokens', 'refresh_token'],
      ['tokens', 'refreshToken'],
    ])
    const email =
      pickString(obj, [['email'], ['cachedEmail'], ['userEmail']]) ??
      jwtClaimString(accessToken, 'email') ??
      jwtClaimString(accessToken, 'sub') ??
      `${this.platform}-imported`
    const expiresAt = parseExpiresAt(
      obj.expires_at ?? obj.expiresAt ?? obj.expiry ?? (obj.tokens as Record<string, unknown>)?.expires_at,
    )

    return {
      provider: this.platform,
      email,
      accessToken,
      refreshToken,
      expiresAt,
      source: 'token_json_file',
      rawMetadata: obj as JsonValue,
    }
  }
}
