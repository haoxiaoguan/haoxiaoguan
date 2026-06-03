// BackupCryptoService — file-level encryption for backup snapshots.
//
// Strategy (mirrors secureBackup pattern in CryptoService):
//   Primary:  safeStorage (Electron OS-keyring-backed) — available in packaged builds.
//   Fallback: AES-256-GCM with a per-file random key derived from Node crypto.
//             Used when safeStorage is unavailable (dev / unit tests).
//
// File format for .db.enc:
//   [4 bytes magic 0x48584742] [1 byte version=1] [payload]
//
// safeStorage payload:
//   safeStorage.encryptString(base64(fileBytes))
//
// AES-256-GCM fallback payload:
//   [1 byte mode=0x01] [32 bytes key] [12 bytes iv] [16 bytes tag] [ciphertext...]
//   The key is stored in plaintext in the file only as a last-resort fallback when
//   safeStorage is completely unavailable. On supported platforms (all packaged
//   builds) safeStorage is always preferred.
//
// Backward compatibility:
//   Files ending in .db without the magic header are treated as plaintext .db files
//   and are returned as-is (no decryption). This lets old backups continue to work.

import { readFile, writeFile, unlink } from 'node:fs/promises'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

// Magic header: ASCII "HXGB" (HaoXiaoGuan Backup)
const MAGIC = Buffer.from([0x48, 0x58, 0x47, 0x42])
const VERSION = 1
// safeStorage mode tag (stored inside the payload)
const MODE_SAFE_STORAGE = 0x00
// AES-GCM fallback mode tag
const MODE_AES_GCM = 0x01

/** Interface satisfied by Electron's safeStorage — injected for testability. */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(plaintext: string): Buffer
  decryptString(encrypted: Buffer): string
}

/**
 * Encrypt a .db file to .db.enc.
 *
 * @param dbPath     Absolute path of the source .db file (must exist).
 * @param encPath    Absolute path to write the .db.enc file to.
 * @param safeStorage Injected safeStorage (or mock). Pass null to force AES fallback.
 * @returns 'safeStorage' | 'aes-gcm' depending on which path was used.
 */
export async function encryptBackupFile(
  dbPath: string,
  encPath: string,
  safeStorage: SafeStorageLike | null,
): Promise<'safeStorage' | 'aes-gcm'> {
  const plainBytes = await readFile(dbPath)

  let payload: Buffer
  let mode: 'safeStorage' | 'aes-gcm'

  if (safeStorage !== null && safeStorageUsable(safeStorage)) {
    // safeStorage path: encrypt the base64 of the raw bytes.
    const encryptedBuf = safeStorage.encryptString(plainBytes.toString('base64'))
    // payload = [MODE_SAFE_STORAGE(1)] [safeStorage ciphertext...]
    payload = Buffer.concat([Buffer.from([MODE_SAFE_STORAGE]), encryptedBuf])
    mode = 'safeStorage'
  } else {
    // AES-256-GCM fallback path.
    const key = randomBytes(32)
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const ciphertext = Buffer.concat([cipher.update(plainBytes), cipher.final()])
    const tag = cipher.getAuthTag() // 16 bytes
    // payload = [MODE_AES_GCM(1)] [key(32)] [iv(12)] [tag(16)] [ciphertext...]
    payload = Buffer.concat([Buffer.from([MODE_AES_GCM]), key, iv, tag, ciphertext])
    mode = 'aes-gcm'
  }

  // Prepend 5-byte header: [magic(4)] [version(1)]
  const header = Buffer.concat([MAGIC, Buffer.from([VERSION])])
  await writeFile(encPath, Buffer.concat([header, payload]))
  return mode
}

/**
 * Decrypt a .db.enc file back to raw SQLite bytes.
 *
 * @param encPath    Absolute path of the .db.enc file.
 * @param safeStorage Injected safeStorage (or mock). Pass null if unavailable.
 * @returns Decrypted SQLite bytes.
 * @throws Error if the file is not a valid .db.enc or decryption fails.
 */
export async function decryptBackupFile(
  encPath: string,
  safeStorage: SafeStorageLike | null,
): Promise<Buffer> {
  const data = await readFile(encPath)

  // Verify magic header
  if (data.length < 5 || !data.subarray(0, 4).equals(MAGIC)) {
    throw new Error(`backup-crypto: invalid magic in ${encPath}`)
  }
  const version = data[4]
  if (version !== VERSION) {
    throw new Error(`backup-crypto: unsupported version ${version} in ${encPath}`)
  }

  const payload = data.subarray(5)
  if (payload.length < 1) {
    throw new Error(`backup-crypto: payload too short in ${encPath}`)
  }

  const modeTag = payload[0]
  const body = payload.subarray(1)

  if (modeTag === MODE_SAFE_STORAGE) {
    if (safeStorage === null || !safeStorageUsable(safeStorage)) {
      throw new Error(
        `backup-crypto: file was encrypted with safeStorage but safeStorage is unavailable`,
      )
    }
    const base64 = safeStorage.decryptString(body)
    return Buffer.from(base64, 'base64')
  } else if (modeTag === MODE_AES_GCM) {
    // Layout: [key(32)] [iv(12)] [tag(16)] [ciphertext...]
    if (body.length < 32 + 12 + 16) {
      throw new Error(`backup-crypto: AES-GCM payload too short in ${encPath}`)
    }
    const key = body.subarray(0, 32)
    const iv = body.subarray(32, 44)
    const tag = body.subarray(44, 60)
    const ciphertext = body.subarray(60)
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()])
  } else {
    throw new Error(`backup-crypto: unknown mode tag 0x${modeTag.toString(16)} in ${encPath}`)
  }
}

/**
 * Check whether a file is an encrypted backup (has .db.enc magic header).
 * Returns false if the file does not exist or cannot be read.
 */
export async function isEncryptedBackup(filePath: string): Promise<boolean> {
  try {
    // Only need the first 4 bytes
    const fd = await import('node:fs/promises')
    const data = await fd.readFile(filePath)
    return data.length >= 4 && data.subarray(0, 4).equals(MAGIC)
  } catch {
    return false
  }
}

/**
 * Decrypt .db.enc to a temporary .db path, for use during restore.
 * Caller is responsible for deleting the temp file after use.
 */
export async function decryptToTemp(
  encPath: string,
  tempDbPath: string,
  safeStorage: SafeStorageLike | null,
): Promise<void> {
  const bytes = await decryptBackupFile(encPath, safeStorage)
  await writeFile(tempDbPath, bytes)
}

/** Delete a file, ignoring ENOENT. */
export async function tryUnlink(filePath: string): Promise<void> {
  try {
    await unlink(filePath)
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') throw err
  }
}

function safeStorageUsable(ss: SafeStorageLike): boolean {
  try {
    return ss.isEncryptionAvailable()
  } catch {
    return false
  }
}
