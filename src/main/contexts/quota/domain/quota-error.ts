// Quota value objects — QuotaError covers the error kinds the quota module
// raises (RepositoryError / NotFound / InvalidCredentialFormat
// / CryptoError). The IPC layer stringifies these via toIpcError so the renderer
// rejection message is a plain string. Message
// strings follow a stable, fixed format.

export type QuotaErrorKind =
  | 'NotFound'
  | 'RepositoryError'
  | 'InvalidCredentialFormat'
  | 'CryptoError'
  | 'Unsupported'

export class QuotaError extends Error {
  readonly kind: QuotaErrorKind

  private constructor(kind: QuotaErrorKind, message: string) {
    super(message)
    this.name = 'QuotaError'
    this.kind = kind
    Object.setPrototypeOf(this, QuotaError.prototype)
  }

  static notFound(entityType: string, id: string): QuotaError {
    return new QuotaError('NotFound', `Entity not found: ${entityType} with id '${id}'`)
  }

  static repositoryError(message: string): QuotaError {
    return new QuotaError('RepositoryError', `Repository error: ${message}`)
  }

  static invalidCredentialFormat(reason: string): QuotaError {
    return new QuotaError('InvalidCredentialFormat', `Invalid credential format: ${reason}`)
  }

  static cryptoError(reason: string): QuotaError {
    return new QuotaError('CryptoError', `Crypto operation failed: ${reason}`)
  }

  static unsupported(reason: string): QuotaError {
    return new QuotaError('Unsupported', reason)
  }
}
