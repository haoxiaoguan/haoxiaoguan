import { existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import {
  encodeSecretStorageBuffer,
  encryptSecretPayload,
  detectSecretPrefix,
  type SafeStorageMode,
} from '../../contexts/credential/infrastructure/vscode-secret-storage'

// Shared state.vscdb writer for switch injection into VSCode-family clients
// whose login lives in encrypted SecretStorage (codebuddy/codebuddy_cn/qoder/
// github_copilot). Mirrors cockpit-tools vscode_inject::inject_secret_to_state_db_*:
//   - encrypt each secret with the app's SafeStorage key (macOS Keychain /
//     Linux secret service), preserving the existing v10/v11 scheme,
//   - store as the {"type":"Buffer","data":[...]} JSON VSCode reads,
//   - plain (non-secret) keys and deletes are applied in the same transaction
//     (used by github_copilot for the login/usage keys + chat cache cleanup).
//
// Encryption (which shells out to `security`) happens BEFORE the synchronous
// better-sqlite3 transaction so the DB is held briefly.

export interface VscdbSecretWrite {
  /** Full ItemTable key, e.g. `secret://{...}` or `secret://aicoding.auth.userInfo`. */
  key: string
  /** UTF-8 plaintext to encrypt (usually JSON). */
  plaintext: string
}

export interface VscdbWriteOps {
  secrets?: VscdbSecretWrite[]
  /** Plain key/value rows written verbatim (no encryption). */
  plain?: Array<{ key: string; value: string }>
  /** Keys to delete (e.g. stale caches). */
  deletes?: string[]
}

/**
 * The DB-write step of an injection. Real impl is writeVscdbItems; tests inject
 * a fake to capture the (unencrypted) ops without touching the OS keychain.
 */
export type VscdbWriter = (dbPath: string, mode: SafeStorageMode, ops: VscdbWriteOps) => Promise<void>

function readExistingValue(db: Database.Database, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM ItemTable WHERE key = ?').get(key) as
    | { value: string | Buffer | null }
    | undefined
  if (!row || row.value === null) return undefined
  return typeof row.value === 'string' ? row.value : row.value.toString('utf8')
}

/** Detect the SafeStorage scheme of an existing encoded Buffer value, or null. */
function existingPrefixOf(rawValue: string | undefined): 'v10' | 'v11' | null {
  if (rawValue === undefined) return null
  try {
    const parsed = JSON.parse(rawValue) as { data?: unknown }
    if (!parsed || !Array.isArray(parsed.data)) return null
    return detectSecretPrefix(Buffer.from(parsed.data as number[]))
  } catch {
    return null
  }
}

/**
 * Read a plain ItemTable value (for read-modify-write cases like Windsurf's
 * codeium.installationId, which must be preserved across switches). Returns
 * undefined when the DB or key is absent.
 */
export type VscdbPlainReader = (dbPath: string, key: string) => string | undefined

export function readVscdbPlain(dbPath: string, key: string): string | undefined {
  if (!existsSync(dbPath)) return undefined
  let db: Database.Database | null = null
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true })
    const row = db.prepare('SELECT value FROM ItemTable WHERE key = ?').get(key) as
      | { value: string | Buffer | null }
      | undefined
    if (!row || row.value === null) return undefined
    return typeof row.value === 'string' ? row.value : row.value.toString('utf8')
  } catch {
    return undefined
  } finally {
    db?.close()
  }
}

export async function writeVscdbItems(
  dbPath: string,
  mode: SafeStorageMode,
  ops: VscdbWriteOps,
): Promise<void> {
  const dir = dirname(dbPath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  let db: Database.Database | null = null
  try {
    db = new Database(dbPath)
    db.pragma('busy_timeout = 4000')
    db.exec('CREATE TABLE IF NOT EXISTS ItemTable (key TEXT PRIMARY KEY, value TEXT)')

    // Encrypt outside the write transaction (spawns `security` on macOS).
    const encrypted: Array<{ key: string; value: string }> = []
    for (const secret of ops.secrets ?? []) {
      const prefix = existingPrefixOf(readExistingValue(db, secret.key))
      const blob = await encryptSecretPayload(secret.plaintext, mode, prefix)
      encrypted.push({ key: secret.key, value: encodeSecretStorageBuffer(blob) })
    }

    const upsert = db.prepare('INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)')
    const del = db.prepare('DELETE FROM ItemTable WHERE key = ?')
    const apply = db.transaction(() => {
      for (const row of encrypted) upsert.run(row.key, row.value)
      for (const row of ops.plain ?? []) upsert.run(row.key, row.value)
      for (const key of ops.deletes ?? []) del.run(key)
    })
    apply()
  } catch (e) {
    throw new Error(
      `写入 state.vscdb 失败（若客户端正在运行，请关闭后重试）：${e instanceof Error ? e.message : String(e)}`,
    )
  } finally {
    db?.close()
  }
}
