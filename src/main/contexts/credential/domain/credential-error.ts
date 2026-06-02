import type { PlatformId } from '../../account/domain/platform-id'
import { platformToAgentId } from '../../account/domain/platform-id'
import type { ImportMethod } from './import-method'

// Credential domain errors — CredentialError (13 variants).
//
// The error carries a "kind" tag in snake_case, but the renderer's catch blocks
// only ever see the stringified message (IPC invoke rejects with a string). Each
// display string is fixed so the renderer error handling behaves consistently.
// The `kind` and structured payload fields are kept as properties for any
// in-process consumer (validation/import services) and for the IPC layer's
// discretion.

export type CredentialErrorKind =
  | 'invalid_credential'
  | 'expired_credential'
  | 'revoked_credential'
  | 'rate_limited'
  | 'unsupported_source'
  | 'import_conflict'
  | 'oauth_port_in_use'
  | 'app_path_not_found'
  | 'malformed_input'
  | 'provider_error'
  | 'network_error'
  | 'storage_error'
  | 'internal'

export class CredentialError extends Error {
  readonly kind: CredentialErrorKind
  /** Structured payload mirroring the serde-tagged variant fields. */
  readonly data: Record<string, unknown>

  private constructor(kind: CredentialErrorKind, message: string, data: Record<string, unknown> = {}) {
    super(message)
    this.name = 'CredentialError'
    this.kind = kind
    this.data = data
    Object.setPrototypeOf(this, CredentialError.prototype)
  }

  /** invalid credential: {reason} */
  static invalidCredential(reason: string): CredentialError {
    return new CredentialError('invalid_credential', `invalid credential: ${reason}`, { reason })
  }

  /** expired credential */
  static expiredCredential(expiredAt?: Date): CredentialError {
    return new CredentialError('expired_credential', 'expired credential', {
      expired_at: expiredAt?.toISOString(),
    })
  }

  /** revoked credential */
  static revokedCredential(): CredentialError {
    return new CredentialError('revoked_credential', 'revoked credential')
  }

  /** rate limited */
  static rateLimited(retryAfterSeconds?: number): CredentialError {
    return new CredentialError('rate_limited', 'rate limited', {
      retry_after_seconds: retryAfterSeconds,
    })
  }

  /** unsupported source: provider={provider:?}, method={method:?} */
  static unsupportedSource(provider: PlatformId, method: ImportMethod): CredentialError {
    return new CredentialError(
      'unsupported_source',
      `unsupported source: provider=${platformToAgentId(provider)}, method=${method}`,
      { provider, method },
    )
  }

  /** import conflict: existing account {existing_account_id} */
  static importConflict(existingAccountId: string): CredentialError {
    return new CredentialError(
      'import_conflict',
      `import conflict: existing account ${existingAccountId}`,
      { existing_account_id: existingAccountId },
    )
  }

  /** oauth port {port} already in use */
  static oauthPortInUse(port: number): CredentialError {
    return new CredentialError('oauth_port_in_use', `oauth port ${port} already in use`, { port })
  }

  /** app path not found for {provider:?} */
  static appPathNotFound(provider: PlatformId): CredentialError {
    return new CredentialError(
      'app_path_not_found',
      `app path not found for ${platformToAgentId(provider)}`,
      { provider },
    )
  }

  /** malformed input: field={field} */
  static malformedInput(field: string): CredentialError {
    return new CredentialError('malformed_input', `malformed input: field=${field}`, { field })
  }

  /** provider error: {message} */
  static providerError(message: string, code?: string): CredentialError {
    return new CredentialError('provider_error', `provider error: ${message}`, { code, message })
  }

  /** network error: {message} */
  static networkError(message: string): CredentialError {
    return new CredentialError('network_error', `network error: ${message}`, { message })
  }

  /** storage error: {message} */
  static storageError(message: string): CredentialError {
    return new CredentialError('storage_error', `storage error: ${message}`, { message })
  }

  /** internal: {message} */
  static internal(message: string): CredentialError {
    return new CredentialError('internal', `internal: ${message}`, { message })
  }
}
