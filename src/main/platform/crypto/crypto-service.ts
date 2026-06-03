import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { readFile, writeFile, mkdir, chmod, stat } from 'node:fs/promises'
import { writeFileSync, chmodSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app, safeStorage } from 'electron'
import { appDataDir } from '../persistence/paths'

// P2-5: in-process record of the master key file's mtime (ms since epoch).
// Populated by loadOrCreateMasterKey; checked by checkMasterKeyMtime().
let _masterKeyFilePath: string | undefined
let _masterKeyMtimeMs: number | undefined

/**
 * Returns a warning string if the master key file's current mtime differs from
 * the value recorded when it was last loaded, or undefined if everything looks
 * consistent. Does NOT throw — mismatch is an operational signal, not a hard
 * failure. Intended to be polled by health-check IPC.
 */
export async function checkMasterKeyMtime(): Promise<string | undefined> {
  if (_masterKeyFilePath === undefined || _masterKeyMtimeMs === undefined) return undefined
  try {
    const { mtimeMs } = await stat(_masterKeyFilePath)
    if (mtimeMs !== _masterKeyMtimeMs) {
      return (
        `master key file mtime changed: recorded ${_masterKeyMtimeMs}, ` +
        `current ${mtimeMs} — possible external modification`
      )
    }
    return undefined
  } catch {
    return undefined // file vanished or unreadable — caller handles elsewhere
  }
}

// AAD binds the ciphertext to its owning account. We use JSON bytes (NOT Rust
// bincode) since there is no data-compat requirement — see spec §5.2.
export interface EnvelopeAad {
  provider: string
  accountId: string
  createdAt: string
}

export interface CredentialEnvelope {
  v: 1
  iv: string // base64
  ciphertext: string // base64
  tag: string // base64
}

const ALGO = 'aes-256-gcm'

export class CryptoService {
  private readonly key: Buffer

  constructor(key: Buffer) {
    if (key.length !== 32) throw new Error('master key must be exactly 32 bytes')
    this.key = key
  }

  encrypt(plaintext: string, aad: EnvelopeAad): CredentialEnvelope {
    const iv = randomBytes(12)
    const cipher = createCipheriv(ALGO, this.key, iv)
    cipher.setAAD(Buffer.from(JSON.stringify(aad), 'utf8'))
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return {
      v: 1,
      iv: iv.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
      tag: tag.toString('base64'),
    }
  }

  decrypt(env: CredentialEnvelope, aad: EnvelopeAad): string {
    const decipher = createDecipheriv(ALGO, this.key, Buffer.from(env.iv, 'base64'))
    decipher.setAAD(Buffer.from(JSON.stringify(aad), 'utf8'))
    decipher.setAuthTag(Buffer.from(env.tag, 'base64'))
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(env.ciphertext, 'base64')),
      decipher.final(),
    ])
    return plaintext.toString('utf8')
  }
}

// Loads (or creates) the 32-byte master key.
//
// CRITICAL: this function must NEVER silently regenerate the key over an
// existing file. Every stored credential is sealed (AES-256-GCM) under this key;
// regenerating it orphans them all, surfacing later as
// "Unsupported state or unable to authenticate data" on decrypt.
//
// Two encodings are supported on disk:
//   - safeStorage ciphertext (packaged builds): OS-encrypted blob.
//   - raw base64 (dev / safeStorage-unavailable): the key's base64, utf8.
//
// We deliberately AVOID safeStorage in unpackaged (dev) builds: on macOS its
// Keychain ACL is bound to the app's code signature, and `electron-rebuild`
// (run before every `dev`/`build`) re-signs the dev binary ad-hoc, which
// invalidates the ACL — so a key written on one launch can't be decrypted on
// the next, and the old behaviour then regenerated it and broke all credentials.
// Packaged builds have a stable signature, so they use safeStorage.
//
// Static imports only: the bytecode (.cjsc) bundle has no dynamic-import
// callback, so `await import(...)` throws ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING.
export async function loadOrCreateMasterKey(keyFilePath?: string): Promise<Buffer> {
  const keyFile = keyFilePath ?? join(appDataDir(), 'master.key.enc')
  const useSafeStorage = isPackaged() && safeStorageAvailable()

  // 1. Try to load an existing key. Try BOTH encodings regardless of mode so a
  //    key written under a previous mode still round-trips.
  let raw: Buffer | undefined
  try {
    raw = await readFile(keyFile)
  } catch {
    raw = undefined // no file yet — fall through to create
  }

  if (raw !== undefined) {
    const recovered = recoverKey(raw, useSafeStorage)
    if (recovered) {
      // P2-4: packaged + safeStorage available + file was raw base64 → re-wrap.
      if (useSafeStorage && isRawBase64Key(raw)) {
        try {
          const rewrapped = safeStorage.encryptString(recovered.toString('base64'))
          writeFileSync(keyFile, rewrapped)
          if (process.platform !== 'win32') {
            try { chmodSync(keyFile, 0o600) } catch { /* best-effort */ }
          }
          console.warn('[crypto] master key upgraded from raw base64 to safeStorage format')
        } catch {
          // safeStorage re-wrap failed — keep original file, continue with raw key
          console.warn('[crypto] master key re-wrap to safeStorage failed; keeping raw base64 file')
        }
      }
      // P2-5: record mtime for change-detection monitoring.
      _masterKeyFilePath = keyFile
      try {
        const { mtimeMs } = await stat(keyFile)
        _masterKeyMtimeMs = mtimeMs
      } catch { /* best-effort — non-fatal */ }
      return recovered
    }
    // A key file exists but could not be decoded. Do NOT overwrite it — that
    // would permanently orphan every stored credential. Surface the failure so
    // the operator can decide (e.g. restore the file or clear credentials).
    throw new Error(
      `master key at ${keyFile} exists but could not be decoded ` +
        `(${raw.length} bytes); refusing to overwrite and orphan stored credentials`,
    )
  }

  // 2. No existing key — create and persist one.
  const key = randomBytes(32)
  await mkdir(dirname(keyFile), { recursive: true })
  if (useSafeStorage) {
    await writeFile(keyFile, safeStorage.encryptString(key.toString('base64')))
  } else {
    await writeFile(keyFile, key.toString('base64'), 'utf8')
  }
  if (process.platform !== 'win32') {
    await chmod(keyFile, 0o600).catch(() => {})
  }
  // P2-5: record mtime for newly created key file.
  _masterKeyFilePath = keyFile
  try {
    const { mtimeMs } = await stat(keyFile)
    _masterKeyMtimeMs = mtimeMs
  } catch { /* best-effort — non-fatal */ }
  return key
}

// Try to decode a key file in both encodings (safeStorage ciphertext, then raw
// base64). Returns the 32-byte key or undefined if neither yields a valid key.
function recoverKey(raw: Buffer, preferSafeStorage: boolean): Buffer | undefined {
  if (preferSafeStorage) {
    const viaSafe = tryDecryptSafeStorage(raw)
    if (viaSafe) return viaSafe
  }
  const viaRaw = tryRawBase64(raw)
  if (viaRaw) return viaRaw
  // Last resort: a file written by a packaged build (safeStorage) being read by
  // a dev build, or vice versa — attempt the other path too.
  if (!preferSafeStorage) {
    const viaSafe = tryDecryptSafeStorage(raw)
    if (viaSafe) return viaSafe
  }
  return undefined
}

function tryDecryptSafeStorage(raw: Buffer): Buffer | undefined {
  if (!safeStorageAvailable()) return undefined
  try {
    const key = Buffer.from(safeStorage.decryptString(raw), 'base64')
    return key.length === 32 ? key : undefined
  } catch {
    return undefined
  }
}

function tryRawBase64(raw: Buffer): Buffer | undefined {
  try {
    const key = Buffer.from(raw.toString('utf8'), 'base64')
    return key.length === 32 ? key : undefined
  } catch {
    return undefined
  }
}

// Returns true when the on-disk bytes are a raw base64-encoded 32-byte key
// (i.e. NOT a safeStorage ciphertext). Used by the P2-4 re-wrap branch to
// confirm an upgrade is warranted before touching the file.
function isRawBase64Key(raw: Buffer): boolean {
  // safeStorage ciphertexts are binary blobs — they are NOT valid UTF-8 base64
  // strings that decode to exactly 32 bytes. tryRawBase64 succeeding is a
  // sufficient indicator that the file is in raw format; additionally confirm
  // safeStorage.decryptString would fail (i.e. it is not already wrapped).
  if (!safeStorageAvailable()) return false
  try {
    // If safeStorage can decrypt it, it is already wrapped — no re-wrap needed.
    const decrypted = safeStorage.decryptString(raw)
    const key = Buffer.from(decrypted, 'base64')
    if (key.length === 32) return false // already safeStorage format
  } catch { /* expected for raw base64 files */ }
  // Confirm it decodes to a valid 32-byte key via raw base64.
  return tryRawBase64(raw) !== undefined
}

function safeStorageAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

function isPackaged(): boolean {
  try {
    return app.isPackaged
  } catch {
    return false
  }
}
