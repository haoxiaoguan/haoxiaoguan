import type { PlatformId } from '../../account/domain/platform-id'
import type {
  CredentialValidationCapability,
  DeepLinkImportCapability,
  FileImportCapability,
  LocalImportCapability,
  OAuthCapability,
} from './capabilities'

// ProviderRegistry — per-platform capability lookup. 对应
// quota::domain::provider_registry::ProviderRegistry. OAuthService / ImportService
// resolve a capability by PlatformId; a missing entry yields undefined, which the
// services translate into a typed UnsupportedSource error.

export class ProviderRegistry {
  private readonly oauthMap = new Map<PlatformId, OAuthCapability>()
  private readonly localImportMap = new Map<PlatformId, LocalImportCapability>()
  private readonly fileImportMap = new Map<PlatformId, FileImportCapability>()
  private readonly deepLinkMap = new Map<PlatformId, DeepLinkImportCapability>()
  private readonly validationMap = new Map<PlatformId, CredentialValidationCapability>()

  registerOAuth(cap: OAuthCapability): void {
    this.oauthMap.set(cap.provider(), cap)
  }
  registerLocalImport(cap: LocalImportCapability): void {
    this.localImportMap.set(cap.provider(), cap)
  }
  registerFileImport(cap: FileImportCapability): void {
    this.fileImportMap.set(cap.provider(), cap)
  }
  registerDeepLink(cap: DeepLinkImportCapability): void {
    this.deepLinkMap.set(cap.provider(), cap)
  }
  registerValidation(cap: CredentialValidationCapability): void {
    this.validationMap.set(cap.provider(), cap)
  }

  oauth(provider: PlatformId): OAuthCapability | undefined {
    return this.oauthMap.get(provider)
  }
  localImport(provider: PlatformId): LocalImportCapability | undefined {
    return this.localImportMap.get(provider)
  }
  fileImport(provider: PlatformId): FileImportCapability | undefined {
    return this.fileImportMap.get(provider)
  }
  deepLink(provider: PlatformId): DeepLinkImportCapability | undefined {
    return this.deepLinkMap.get(provider)
  }
  validation(provider: PlatformId): CredentialValidationCapability | undefined {
    return this.validationMap.get(provider)
  }

  /** Union of all registered provider ids (sorted), for diagnostics. */
  registeredProviders(): PlatformId[] {
    const all = new Set<PlatformId>()
    for (const m of [
      this.oauthMap,
      this.localImportMap,
      this.fileImportMap,
      this.deepLinkMap,
      this.validationMap,
    ]) {
      for (const k of m.keys()) all.add(k)
    }
    return [...all].sort()
  }
}
