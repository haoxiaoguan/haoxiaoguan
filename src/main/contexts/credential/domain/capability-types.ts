import type { JsonValue } from '../../account/domain/platform-account-profile'
import type { PlatformId } from '../../account/domain/platform-id'
import { platformToAgentId } from '../../account/domain/platform-id'

// Shared credential capability value objects that the credential module depends
// on (OAuthMode, OAuthPending, ImportSource, ImportedCredentialMaterial,
// ValidationState, CredentialValidationResult). They live with the credential
// context that owns the import/oauth flows; the quota context re-uses these
// types.

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

/** OAuth mode: loopback PKCE or native deep-link callback. Serialises snake_case. */
export type OAuthMode = 'loopback_pkce' | 'deep_link'

export function parseOAuthMode(input: string): OAuthMode {
  if (input === 'loopback_pkce') return 'loopback_pkce'
  if (input === 'deep_link') return 'deep_link'
  throw new Error(`Unknown OAuth mode: ${input}`)
}

/**
 * Pending OAuth handle returned by start_oauth.
 * `state` and `codeVerifier` are internal (persisted) and MUST NOT be serialised
 * to the frontend — see toJson().
 */
export interface OAuthPending {
  pendingId: string
  authorizeUrl: string
  redirectPath: string
  boundPort?: number
  /** internal — persisted, never sent to the frontend */
  state: string
  /** internal — persisted, never sent to the frontend */
  codeVerifier: string
}

/** Wire shape for OAuthPending (state/code_verifier stripped, snake_case). */
export interface OAuthPendingJson {
  pending_id: string
  authorize_url: string
  redirect_path: string
  bound_port?: number
}

export function oauthPendingToJson(p: OAuthPending): OAuthPendingJson {
  const out: OAuthPendingJson = {
    pending_id: p.pendingId,
    authorize_url: p.authorizeUrl,
    redirect_path: p.redirectPath,
  }
  if (p.boundPort !== undefined && p.boundPort !== null) out.bound_port = p.boundPort
  return out
}

// ---------------------------------------------------------------------------
// Imported credential material — normalised output of all four import paths.
// ---------------------------------------------------------------------------

/** Audit/telemetry source tag. Serialises snake_case; OAuth serialises as "oauth". */
export type ImportSource = 'oauth' | 'local_scan' | 'token_json_file' | 'deep_link'

export interface ImportedCredentialMaterial {
  provider: PlatformId
  email: string
  accessToken: string
  refreshToken?: string
  expiresAt?: Date
  source: ImportSource
  rawMetadata?: JsonValue
}

/** Wire shape (snake_case; optional fields omitted when undefined). */
export interface ImportedCredentialMaterialJson {
  provider: string
  email: string
  access_token: string
  refresh_token?: string
  expires_at?: string
  source: ImportSource
  raw_metadata?: JsonValue
}

export function importedMaterialToJson(
  m: ImportedCredentialMaterial,
): ImportedCredentialMaterialJson {
  const out: ImportedCredentialMaterialJson = {
    provider: platformToAgentId(m.provider),
    email: m.email,
    access_token: m.accessToken,
    source: m.source,
  }
  if (m.refreshToken !== undefined) out.refresh_token = m.refreshToken
  if (m.expiresAt !== undefined) out.expires_at = m.expiresAt.toISOString()
  if (m.rawMetadata !== undefined) out.raw_metadata = m.rawMetadata
  return out
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** 8-variant validation state. Serialises snake_case. */
export type ValidationState =
  | 'valid'
  | 'expired'
  | 'revoked'
  | 'rate_limited'
  | 'network_error'
  | 'unknown_error'
  | 'unsupported'
  | 'pending'

export interface CredentialValidationResult {
  state: ValidationState
  checkedAt: Date
  details?: string
  expiresAt?: Date
}

/** Wire shape (snake_case; optional fields omitted when undefined). */
export interface CredentialValidationResultJson {
  state: ValidationState
  checked_at: string
  details?: string
  expires_at?: string
}

export function validationResultToJson(
  r: CredentialValidationResult,
): CredentialValidationResultJson {
  const out: CredentialValidationResultJson = {
    state: r.state,
    checked_at: r.checkedAt.toISOString(),
  }
  if (r.details !== undefined) out.details = r.details
  if (r.expiresAt !== undefined) out.expires_at = r.expiresAt.toISOString()
  return out
}

export function validNow(): CredentialValidationResult {
  return { state: 'valid', checkedAt: new Date() }
}

export function unsupportedNow(): CredentialValidationResult {
  return { state: 'unsupported', checkedAt: new Date() }
}
