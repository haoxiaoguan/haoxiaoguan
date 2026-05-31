// BackupError — mirrors Rust BackupError enum variants.
// All IPC commands map errors to plain string via .message.

export type BackupErrorKind = 'Io' | 'Db' | 'InvalidFilename' | 'NotFound'

export class BackupError extends Error {
  readonly kind: BackupErrorKind

  constructor(kind: BackupErrorKind, detail: string) {
    super(`${kind}: ${detail}`)
    this.kind = kind
    this.name = 'BackupError'
  }

  static io(detail: string): BackupError {
    return new BackupError('Io', detail)
  }

  static db(detail: string): BackupError {
    return new BackupError('Db', detail)
  }

  static invalidFilename(name: string): BackupError {
    return new BackupError('InvalidFilename', name)
  }

  static notFound(name: string): BackupError {
    return new BackupError('NotFound', name)
  }
}
