import type { PlatformId } from '../../../account/domain/platform-id'
import { Credential, type CredentialJson } from '../../domain/credential'
import type { CredentialValidationCapability } from '../../domain/capabilities'
import type { CredentialValidationResult } from '../../domain/capability-types'
import type { StoredEnvelope } from '../../domain/envelope'
import type { CryptoService } from '../../../../platform/crypto/crypto-service'

// Generic, network-free credential validation by token expiry. The Rust source
// shipped only a stub validator (returns unsupported), so every account showed
// 未支持 in the top-right corner regardless of platform. This classifies any
// stored credential WITHOUT a network call, which is correct for every
// token/API-key provider:
//   - no expiry (e.g. API keys)     → valid (does not expire)
//   - not yet expired               → valid
//   - expired but has refresh token → valid (auto-refreshes on next use)
//   - expired and no refresh token  → expired
//   - decrypt/parse failure         → unknown_error (don't claim unsupported)
//
// Registered per-platform (provider() returns the id it was constructed with),
// so the same logic backs cursor, github_copilot, kiro, windsurf, qoder, etc.
export class TokenExpiryValidationCapability implements CredentialValidationCapability {
  constructor(
    private readonly platform: PlatformId,
    private readonly crypto: CryptoService,
  ) {}

  provider(): PlatformId {
    return this.platform
  }

  async validate(envelope: StoredEnvelope): Promise<CredentialValidationResult> {
    const checkedAt = new Date()
    let credential: Credential
    try {
      const plaintext = this.crypto.decrypt(envelope.envelope, envelope.aad)
      credential = Credential.fromJson(JSON.parse(plaintext) as CredentialJson)
    } catch (e) {
      return {
        state: 'unknown_error',
        checkedAt,
        details: `decrypt failed: ${e instanceof Error ? e.message : String(e)}`,
      }
    }

    const hasRefresh = credential.refreshToken !== undefined && credential.refreshToken.trim() !== ''
    if (!credential.isExpired() || hasRefresh) {
      return { state: 'valid', checkedAt, expiresAt: credential.expiresAt }
    }
    return {
      state: 'expired',
      checkedAt,
      details: 'access token expired and no refresh token available',
      expiresAt: credential.expiresAt,
    }
  }
}
