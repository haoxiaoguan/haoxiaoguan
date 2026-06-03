// BackupFsService — filesystem adapter for backup directory operations.
// Mirrors Rust infrastructure/backup_fs.rs.
// Uses Node fs/promises; mtime is the source of createdAt (Unix seconds).

import { readdir, stat, unlink, rename, mkdir } from 'node:fs/promises'
import { chmodSync } from 'node:fs'
import { join, extname } from 'node:path'
import { homedir } from 'node:os'
import { BackupEntry } from '../domain/backup-entry'
import { BackupError } from '../domain/backup-error'

/** Default backup directory: ~/.haoxiaoguan/backups/ */
export function defaultBackupDir(): string {
  return join(homedir(), '.haoxiaoguan', 'backups')
}

/**
 * Validate a user-supplied backup filename.
 * Rules (mirrors Rust validate_filename):
 *   - must not be empty
 *   - must not contain '/', '\', or '..'
 *   - must end with '.db' (plaintext) or '.db.enc' (encrypted)
 */
export function validateFilename(name: string): void {
  if (
    !name ||
    name.includes('/') ||
    name.includes('\\') ||
    name.includes('..') ||
    (!name.endsWith('.db') && !name.endsWith('.db.enc'))
  ) {
    throw BackupError.invalidFilename(name)
  }
}

/** Build a BackupEntry from a file path using mtime as createdAt. */
async function entryFromPath(dir: string, filename: string): Promise<BackupEntry | null> {
  try {
    const fullPath = join(dir, filename)
    const meta = await stat(fullPath)
    const sizeBytes = meta.size
    const createdAt = Math.floor(meta.mtimeMs / 1000)
    return BackupEntry.create(filename, sizeBytes, createdAt)
  } catch {
    return null
  }
}

/**
 * List all .db and .db.enc files in the backup directory, sorted by mtime descending.
 * Returns empty array if directory does not exist.
 */
export async function listBackups(dir: string): Promise<BackupEntry[]> {
  try {
    const names = await readdir(dir)
    const dbFiles = names.filter((n) => n.endsWith('.db') || n.endsWith('.db.enc'))
    const entries = await Promise.all(dbFiles.map((n) => entryFromPath(dir, n)))
    const valid = entries.filter((e): e is BackupEntry => e !== null)
    valid.sort((a, b) => b.createdAt - a.createdAt)
    return valid
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return []
    throw BackupError.io(String(err))
  }
}

/**
 * Delete old backups beyond the retain count (keeps the newest `retain` files).
 * Mirrors Rust cleanup_old_backups.
 */
export async function cleanupOldBackups(dir: string, retain: number): Promise<void> {
  const entries = await listBackups(dir)
  const toDelete = entries.slice(retain)
  await Promise.all(
    toDelete.map((e) =>
      unlink(join(dir, e.filename)).catch(() => {
        /* best-effort, ignore errors */
      }),
    ),
  )
}

/** Ensure the backup directory exists.
 * On Unix, also sets 0700 permissions so only the owning user can read backups.
 * chmod failure is non-fatal (best-effort). */
export async function ensureBackupDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  if (process.platform !== 'win32') {
    try {
      chmodSync(dir, 0o700)
    } catch {
      // best-effort — do not block backup creation if chmod fails
    }
  }
}

/** Delete a single backup file. Throws BackupError.notFound if missing. */
export async function deleteBackup(dir: string, filename: string): Promise<void> {
  validateFilename(filename)
  const fullPath = join(dir, filename)
  try {
    await unlink(fullPath)
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') throw BackupError.notFound(filename)
    throw BackupError.io(String(err))
  }
}

/**
 * Rename a backup file on disk. Returns the updated BackupEntry.
 * newFilename must already have the .db suffix appended by the caller.
 */
export async function renameBackup(
  dir: string,
  oldFilename: string,
  newFilename: string,
): Promise<BackupEntry> {
  validateFilename(oldFilename)
  validateFilename(newFilename)
  const oldPath = join(dir, oldFilename)
  const newPath = join(dir, newFilename)

  // Check old exists
  try {
    await stat(oldPath)
  } catch {
    throw BackupError.notFound(oldFilename)
  }

  // Check new does not already exist
  try {
    await stat(newPath)
    // If we get here, the file exists — conflict
    throw BackupError.invalidFilename(`${newFilename} already exists`)
  } catch (err: unknown) {
    if (err instanceof BackupError) throw err
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') throw BackupError.io(String(err))
    // ENOENT is expected — target does not exist, proceed
  }

  try {
    await rename(oldPath, newPath)
  } catch (err: unknown) {
    throw BackupError.io(String(err))
  }

  const entry = await entryFromPath(dir, newFilename)
  if (!entry) throw BackupError.io(`stat failed after rename: ${newFilename}`)
  return entry
}
