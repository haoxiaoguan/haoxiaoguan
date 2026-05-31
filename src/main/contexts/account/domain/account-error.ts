// Account domain errors. 对应 AccountError enum.
//
// In the IPC layer these are stringified via toIpcError(); the message strings
// here match the source thiserror #[error(...)] formats byte-for-byte so the
// renderer's error-handling (which only sees strings) behaves identically.

export type AccountErrorKind =
  | 'NameTooLong'
  | 'TooManyTags'
  | 'TagTooLong'
  | 'CredentialExpired'
  | 'InvalidCredentialFormat'
  | 'CryptoError'
  | 'DuplicateIdentifier'
  | 'NotesTooLong'
  | 'NotFound'
  | 'RepositoryError'

export class AccountError extends Error {
  readonly kind: AccountErrorKind

  private constructor(kind: AccountErrorKind, message: string) {
    super(message)
    this.name = 'AccountError'
    this.kind = kind
    // Restore prototype chain (TS target ES2022 keeps instanceof working, but be safe).
    Object.setPrototypeOf(this, AccountError.prototype)
  }

  static nameTooLong(max: number, actual: number): AccountError {
    return new AccountError('NameTooLong', `Name too long: max ${max} characters, got ${actual}`)
  }

  static tooManyTags(max: number, actual: number): AccountError {
    return new AccountError('TooManyTags', `Too many tags: max ${max}, got ${actual}`)
  }

  static tagTooLong(max: number, actual: number): AccountError {
    return new AccountError('TagTooLong', `Tag too long: max ${max} characters, got ${actual}`)
  }

  static credentialExpired(accountId: string): AccountError {
    return new AccountError('CredentialExpired', `Credential has expired for account ${accountId}`)
  }

  static invalidCredentialFormat(reason: string): AccountError {
    return new AccountError('InvalidCredentialFormat', `Invalid credential format: ${reason}`)
  }

  static cryptoError(reason: string): AccountError {
    return new AccountError('CryptoError', `Crypto operation failed: ${reason}`)
  }

  static duplicateIdentifier(email: string, platform: string): AccountError {
    return new AccountError(
      'DuplicateIdentifier',
      `Duplicate identifier: account with email '${email}' already exists for platform ${platform}`,
    )
  }

  static notesTooLong(max: number, actual: number): AccountError {
    return new AccountError('NotesTooLong', `Notes too long: max ${max} characters, got ${actual}`)
  }

  static notFound(entityType: string, id: string): AccountError {
    return new AccountError('NotFound', `Entity not found: ${entityType} with id '${id}'`)
  }

  static repositoryError(message: string): AccountError {
    return new AccountError('RepositoryError', `Repository error: ${message}`)
  }
}
