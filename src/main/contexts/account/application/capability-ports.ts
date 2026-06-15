import type { PlatformId } from '../domain/platform-id'
import type { JsonValue } from '../domain/platform-account-profile'

// Capability ports for validation / quota / health (CredentialValidationCapability,
// QuotaFetchCapability), implemented by the quota/agents layers at integration.
// Defined here as consumer ports so the account application services compile and
// unit-test in isolation.

// ValidationState — 8-state enum. Wire form is snake_case.
export type ValidationState =
  | 'valid'
  | 'expired'
  | 'revoked'
  | 'rate_limited'
  | 'network_error'
  | 'unknown_error'
  | 'unsupported'
  | 'pending'

// CredentialValidationResult — wire shape is snake_case (health/credential
// services use snake_case on the wire).
export interface CredentialValidationResult {
  state: ValidationState
  checked_at: string
  details?: string
  expires_at?: string
}

export interface QuotaFetchModel {
  model_name: string
  used: number
  total: number
  reset_at?: string
}

export interface QuotaFetchResult {
  outcome: 'success' | 'unsupported' | 'stale' | 'failed'
  source: 'live' | 'cache' | 'none'
  freshness: 'fresh' | 'stale' | 'unknown'
  fetched_at: string
  models: QuotaFetchModel[]
  error?: string | undefined
}

// HealthSnapshot — wire shape snake_case.
export interface HealthSnapshot {
  account_id: string
  validation: CredentialValidationResult
  quota?: QuotaFetchResult | undefined
  checked_at: string
}

// Capability registry the validation/health/switch_v2 services resolve against.
// Looks up per-platform validation / quota-fetch / injection capabilities.
export interface ValidationCapability {
  validate(accountId: string): Promise<CredentialValidationResult>
}

export interface QuotaCapability {
  fetchQuota(accountId: string): Promise<QuotaFetchResult>
}

export interface ProviderCapabilityRegistry {
  validation(platform: PlatformId): ValidationCapability | undefined
  quota(platform: PlatformId): QuotaCapability | undefined
}

// Provider lookup for an account: resolves the account's platform so the
// service can pick the right capability. Implemented by the account repo
// adapter (it knows agent_id) at integration.
export interface AccountPlatformLookup {
  platformOf(accountId: string): Promise<PlatformId | undefined>
}

export type { JsonValue }
