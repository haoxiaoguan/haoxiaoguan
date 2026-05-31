import type { PlatformId } from '../../account/domain/platform-id'
import type {
  CredentialValidationResult,
  ImportedCredentialMaterial,
  OAuthMode,
  OAuthPending,
} from './capability-types'
import type { StoredEnvelope } from './envelope'

// Credential capability traits — 对应 quota::domain::capabilities
// async traits that the credential module dispatches through ProviderRegistry.
// Each provider implements only the capabilities it supports; the registry
// returns undefined when a provider has no implementation for a capability,
// which the application services translate into a typed UnsupportedSource error.

/** OAuth capability: start authorization + exchange callback for tokens. */
export interface OAuthCapability {
  provider(): PlatformId
  startOAuth(mode: OAuthMode): Promise<OAuthPending>
  completeOAuth(pendingId: string, code: string): Promise<ImportedCredentialMaterial>
}

/** Local scan: read existing login state from the IDE's own storage. */
export interface LocalImportCapability {
  provider(): PlatformId
  scanLocal(): Promise<ImportedCredentialMaterial[]>
}

/** File import: user pastes token JSON or selects a file. */
export interface FileImportCapability {
  provider(): PlatformId
  importFromJson(payload: string): Promise<ImportedCredentialMaterial>
}

/** Deep-link: third-party triggered haoxiaoguan://import/{provider}?token=... */
export interface DeepLinkImportCapability {
  provider(): PlatformId
  importFromDeeplink(url: string): Promise<ImportedCredentialMaterial>
}

/** Credential liveness validation. */
export interface CredentialValidationCapability {
  provider(): PlatformId
  validate(envelope: StoredEnvelope): Promise<CredentialValidationResult>
}
