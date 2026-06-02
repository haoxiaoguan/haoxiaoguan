// ProviderRegistry — composition container of the 7 capability maps.
//
// The application
// service queries `registry.quota(platform)` (etc.) to obtain a capability
// without per-platform if/else branches. registeredProviders() returns the
// union of all keys, sorted (stable, by the canonical AgentId string).
//
// This is the REAL registry the container should inject in place of the
// nullProviderCapabilityRegistry placeholder (see manifest §5).

import type { PlatformId } from './platform-id'
import type {
  CredentialInjectorCapability,
  CredentialValidationCapability,
  DeepLinkImportCapability,
  FileImportCapability,
  LocalImportCapability,
  OAuthCapability,
  QuotaCapability,
} from './capabilities'

export class ProviderRegistry {
  private readonly oauthMap = new Map<PlatformId, OAuthCapability>()
  private readonly localImportMap = new Map<PlatformId, LocalImportCapability>()
  private readonly fileImportMap = new Map<PlatformId, FileImportCapability>()
  private readonly deepLinkMap = new Map<PlatformId, DeepLinkImportCapability>()
  private readonly validationMap = new Map<PlatformId, CredentialValidationCapability>()
  private readonly quotaMap = new Map<PlatformId, QuotaCapability>()
  private readonly injectorMap = new Map<PlatformId, CredentialInjectorCapability>()

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
  registerQuota(cap: QuotaCapability): void {
    this.quotaMap.set(cap.provider(), cap)
  }
  registerInjector(cap: CredentialInjectorCapability): void {
    this.injectorMap.set(cap.provider(), cap)
  }

  oauth(platform: PlatformId): OAuthCapability | undefined {
    return this.oauthMap.get(platform)
  }
  localImport(platform: PlatformId): LocalImportCapability | undefined {
    return this.localImportMap.get(platform)
  }
  fileImport(platform: PlatformId): FileImportCapability | undefined {
    return this.fileImportMap.get(platform)
  }
  deepLink(platform: PlatformId): DeepLinkImportCapability | undefined {
    return this.deepLinkMap.get(platform)
  }
  validation(platform: PlatformId): CredentialValidationCapability | undefined {
    return this.validationMap.get(platform)
  }
  quota(platform: PlatformId): QuotaCapability | undefined {
    return this.quotaMap.get(platform)
  }
  injector(platform: PlatformId): CredentialInjectorCapability | undefined {
    return this.injectorMap.get(platform)
  }

  /** Union of all providers with any registered capability, sorted by id string. */
  registeredProviders(): PlatformId[] {
    const set = new Set<PlatformId>()
    for (const k of this.oauthMap.keys()) set.add(k)
    for (const k of this.localImportMap.keys()) set.add(k)
    for (const k of this.fileImportMap.keys()) set.add(k)
    for (const k of this.deepLinkMap.keys()) set.add(k)
    for (const k of this.validationMap.keys()) set.add(k)
    for (const k of this.quotaMap.keys()) set.add(k)
    for (const k of this.injectorMap.keys()) set.add(k)
    return [...set].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  }
}
