import type { PlatformId } from '../../account/domain/platform-id'
import { CredentialError } from '../domain/credential-error'
import type { ImportedCredentialMaterial } from '../domain/capability-types'
import type { ProviderRegistry } from '../domain/provider-registry'

// ImportService — unified entry for the three non-OAuth import paths
// (TokenJson / LocalScan / DeepLink).
//
// This service does NOT persist credentials — writing the envelope into the
// CredentialRepository is the account import flow's job. It only normalises
// external data into ImportedCredentialMaterial via the provider's capability,
// returning UnsupportedSource when the provider has no matching capability.

export class ImportService {
  constructor(private readonly registry: ProviderRegistry) {}

  /** Import from token JSON text. */
  async importFromJson(provider: PlatformId, payload: string): Promise<ImportedCredentialMaterial> {
    const cap = this.registry.fileImport(provider)
    if (!cap) {
      throw CredentialError.unsupportedSource(provider, 'token_json')
    }
    return cap.importFromJson(payload)
  }

  /** Scan the locally-installed IDE for an existing login state. */
  async scanLocal(provider: PlatformId): Promise<ImportedCredentialMaterial[]> {
    const cap = this.registry.localImport(provider)
    if (!cap) {
      throw CredentialError.unsupportedSource(provider, 'local_scan')
    }
    return cap.scanLocal()
  }

  /** Handle a deep-link import URL, e.g. haoxiaoguan://import/kiro?token=... */
  async importFromDeeplink(provider: PlatformId, url: string): Promise<ImportedCredentialMaterial> {
    const cap = this.registry.deepLink(provider)
    if (!cap) {
      throw CredentialError.unsupportedSource(provider, 'deep_link')
    }
    return cap.importFromDeeplink(url)
  }
}
