import type { JsonValue } from '../../../account/domain/platform-account-profile'
import type { PlatformId } from '../../../account/domain/platform-id'
import { platformToAgentId } from '../../../account/domain/platform-id'
import type { DeepLinkImportCapability } from '../../domain/capabilities'
import type { ImportedCredentialMaterial } from '../../domain/capability-types'
import { CredentialError } from '../../domain/credential-error'
import { jwtClaimString, parseExpiresAt } from '../scan-helpers'

// Deep-link import capability — handles haoxiaoguan://import/{provider}?token=...
// URLs. The source registers deep-link as a per-provider stub, but the IPC
// channel (import_deeplink) + scheme are real, so this provides a portable
// parser: it validates the URL host/path matches the provider, then extracts the
// token + optional refresh_token/email/expires_at query params.
//
// Construct one per provider so the registry can key it by PlatformId.

export class DeepLinkImportCapabilityImpl implements DeepLinkImportCapability {
  constructor(private readonly platform: PlatformId) {}

  provider(): PlatformId {
    return this.platform
  }

  async importFromDeeplink(rawUrl: string): Promise<ImportedCredentialMaterial> {
    let url: URL
    try {
      url = new URL(rawUrl)
    } catch {
      throw CredentialError.malformedInput('url (not a valid URL)')
    }
    if (url.protocol !== 'haoxiaoguan:') {
      throw CredentialError.malformedInput(`url (unexpected scheme: ${url.protocol})`)
    }
    // haoxiaoguan://import/{provider} — host is "import", first path segment is provider.
    const segments = url.pathname.split('/').filter((s) => s.length > 0)
    const providerSlug = url.host === 'import' ? segments[0] : url.host
    if (providerSlug && providerSlug !== platformToAgentId(this.platform)) {
      // Allow kebab spellings (e.g. github-copilot) too; only reject obvious mismatch.
      const normalized = providerSlug.replace(/-/g, '_')
      if (normalized !== platformToAgentId(this.platform)) {
        throw CredentialError.malformedInput(
          `url (provider mismatch: ${providerSlug} != ${platformToAgentId(this.platform)})`,
        )
      }
    }

    const params = url.searchParams
    const accessToken = params.get('token') ?? params.get('access_token') ?? undefined
    if (!accessToken) {
      throw CredentialError.invalidCredential('deep-link missing token')
    }
    const refreshToken = params.get('refresh_token') ?? undefined
    const email =
      params.get('email') ??
      jwtClaimString(accessToken, 'email') ??
      jwtClaimString(accessToken, 'sub') ??
      `${this.platform}-imported`
    const expiresAt = parseExpiresAt(params.get('expires_at') ?? params.get('expires_in'))

    const rawMetadata: JsonValue = {}
    for (const [k, v] of params.entries()) {
      rawMetadata[k] = v
    }

    return {
      provider: this.platform,
      email,
      accessToken,
      refreshToken: refreshToken ?? undefined,
      expiresAt,
      source: 'deep_link',
      rawMetadata,
    }
  }
}
