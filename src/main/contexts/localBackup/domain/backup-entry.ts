// BackupEntry value object — mirrors Rust BackupEntry (serde rename_all = "camelCase").
// createdAt is derived from filesystem mtime (Unix seconds), NOT a stored timestamp.

export interface BackupEntryData {
  filename: string
  sizeBytes: number
  createdAt: number
}

export class BackupEntry {
  readonly filename: string
  readonly sizeBytes: number
  readonly createdAt: number

  private constructor(filename: string, sizeBytes: number, createdAt: number) {
    this.filename = filename
    this.sizeBytes = sizeBytes
    this.createdAt = createdAt
  }

  static create(filename: string, sizeBytes: number, createdAt: number): BackupEntry {
    return new BackupEntry(filename, sizeBytes, createdAt)
  }

  toJson(): BackupEntryData {
    return {
      filename: this.filename,
      sizeBytes: this.sizeBytes,
      createdAt: this.createdAt,
    }
  }
}
