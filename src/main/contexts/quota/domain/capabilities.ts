// Capability layer value objects + the 7 capability interfaces.
//
// The ProviderRegistry keys
// these by PlatformId. QuotaFetchResult is the product of a live fetch; its
// provider_payload is normalised by the quota-state parsers and updatedCredential
// (NOT serialised) is persisted by the application service.
//
// Enum string forms are snake_case.

import type { JsonValue } from '../../account/domain/platform-account-profile'
import type { Credential } from '../../account/domain/credential'
import type { ModelQuota } from './quota'
import type { PlatformId } from './platform-id'

export type QuotaOutcome = 'success' | 'unsupported' | 'stale' | 'failed'
export type QuotaSource = 'live' | 'cache' | 'none'
export type QuotaFreshness = 'fresh' | 'stale' | 'unknown'

export type OAuthMode = 'loopback_pkce' | 'deep_link'

export type ImportSource = 'oauth' | 'local_scan' | 'token_json_file' | 'deep_link'

export type ValidationState =
  | 'valid'
  | 'expired'
  | 'revoked'
  | 'rate_limited'
  | 'network_error'
  | 'unknown_error'
  | 'unsupported'
  | 'pending'

/** Result of a live quota fetch. updatedCredential + provider_payload are
 *  internal — updatedCredential is never serialised to the frontend. */
export interface QuotaFetchResult {
  outcome: QuotaOutcome
  source: QuotaSource
  freshness: QuotaFreshness
  fetchedAt: Date
  models: ModelQuota[]
  /** provider raw quota response; per-platform parsers extract metrics from it. */
  providerPayload: JsonValue
  /** new token captured during refresh; persisted by the app service, not sent to UI. */
  updatedCredential?: Credential | undefined
  /** human-readable error when outcome is non-success. */
  error?: string | undefined
}

/** Build a QuotaFetchResult representing an Unsupported platform. */
export function unsupportedFetchResult(): QuotaFetchResult {
  return {
    outcome: 'unsupported',
    source: 'none',
    freshness: 'unknown',
    fetchedAt: new Date(),
    models: [],
    providerPayload: null,
    updatedCredential: undefined,
    error: undefined,
  }
}

// OAuth handle returned by start_oauth. state/codeVerifier are internal-only and
// stripped from any JSON projection sent to the frontend.
export interface OAuthPending {
  pendingId: string
  authorizeUrl: string
  redirectPath: string
  boundPort?: number | undefined
  state: string
  codeVerifier: string
}

// Standardised imported credential material from any source (OAuth/scan/file/deeplink).
export interface ImportedCredentialMaterial {
  provider: PlatformId
  email: string
  accessToken: string
  refreshToken?: string | undefined
  expiresAt?: Date | undefined
  source: ImportSource
  rawMetadata?: JsonValue | undefined
}

// Credential validation result. checkedAt is always populated.
export interface CredentialValidationResult {
  state: ValidationState
  checkedAt: Date
  details?: string
  expiresAt?: Date
}

// IDE launch hint passed to a credential injector.
export interface LaunchOptions {
  launchOnSwitch: boolean
  executableOverride?: string | undefined
}

export const DEFAULT_LAUNCH_OPTIONS: LaunchOptions = {
  launchOnSwitch: false,
  executableOverride: undefined,
}

// ===== capability interfaces (7 traits) =====

/** OAuth capability: start an OAuth flow + complete it with a callback code. */
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

/** DeepLink: third-party-triggered haoxiaoguan://import?token=... flow. */
export interface DeepLinkImportCapability {
  provider(): PlatformId
  importFromDeeplink(url: string): Promise<ImportedCredentialMaterial>
}

/** Credential liveness validation. */
export interface CredentialValidationCapability {
  provider(): PlatformId
  validate(credential: Credential): Promise<CredentialValidationResult>
}

/** Quota fetch. The credential context's OAuthService can also call this to
 *  refresh quota-bearing HTTP for an account (see manifest boundary note). */
export interface QuotaCapability {
  provider(): PlatformId
  fetchQuota(credential: Credential, profilePayload: JsonValue): Promise<QuotaFetchResult>
}

/** Credential injection: write a pooled credential back into the IDE/CLI. */
export interface CredentialInjectorCapability {
  provider(): PlatformId
  inject(credential: Credential, options: LaunchOptions): Promise<void>
}
