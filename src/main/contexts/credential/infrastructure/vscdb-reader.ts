import { existsSync } from 'node:fs'
import Database from 'better-sqlite3'
import { CredentialError } from '../domain/credential-error'

// state.vscdb reader — 对应 read_vscdb_item (rusqlite). Opens a
// VSCode-family ItemTable (key TEXT, value BLOB) sqlite file read-only and reads
// a single key. Returns null when the file is absent or the key is missing.
//
// Uses better-sqlite3 (synchronous), the codebase's installed sqlite driver. The
// DB may be locked by a running IDE; we open read-only to minimise contention.

export function readVscdbItem(dbPath: string, key: string): string | null {
  if (!existsSync(dbPath)) return null
  let db: Database.Database | null = null
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true })
    const row = db.prepare('SELECT value FROM ItemTable WHERE key = ?').get(key) as
      | { value: string | Buffer | number | null }
      | undefined
    if (!row || row.value === null || row.value === undefined) return null
    const text =
      typeof row.value === 'string'
        ? row.value
        : Buffer.isBuffer(row.value)
          ? row.value.toString('utf8')
          : String(row.value)
    const trimmed = text.trim()
    return trimmed.length > 0 ? trimmed : null
  } catch (e) {
    throw CredentialError.storageError(
      `read state.vscdb (${dbPath} / ${key}): ${e instanceof Error ? e.message : String(e)}`,
    )
  } finally {
    db?.close()
  }
}

/** Build the SecretStorage ItemTable key (secret://{extensionId,key} JSON). */
export function buildSecretStorageItemKey(extensionId: string, key: string): string {
  return `secret://{"extensionId":"${extensionId}","key":"${key}"}`
}

export function normalizeNonEmpty(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}
