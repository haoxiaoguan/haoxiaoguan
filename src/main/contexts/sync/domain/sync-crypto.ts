import { pbkdf2, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'
import { promisify } from 'node:util'

// Sync crypto — wraps the 32-byte master key under the user's sync password.
// The wrapping scheme is fixed EXACTLY as below for cross-device
// compatibility with keys wrapped by other clients:
//   DEK = PBKDF2-HMAC-SHA256(syncPassword, salt, 600_000, 32 bytes)
//   ciphertext = AES-256-GCM(DEK, nonce, masterKey, AAD = "v{version}:{keyId}")
//
// PBKDF2 with 600k iterations is CPU-heavy, so we use Node's async crypto.pbkdf2
// (runs on libuv threadpool, off the main thread) — never a pure-JS impl.
//
// WrappedKey is the persisted form (all base64), serialized to master.key.enc.

const pbkdf2Async = promisify(pbkdf2)

const PBKDF2_ITERATIONS = 600_000
const SALT_LEN = 16
const NONCE_LEN = 12
const KEY_LEN = 32
const WRAPPED_KEY_VERSION = 1

export type SyncCryptoErrorKind = 'encrypt' | 'decrypt' | 'malformed'

/**
 * Crypto-layer error. `decrypt` typically means a wrong sync password — the
 * application layer maps it to a Password SyncError so the UI prompts re-entry.
 */
export class SyncCryptoError extends Error {
  readonly kind: SyncCryptoErrorKind

  constructor(kind: SyncCryptoErrorKind, message: string) {
    super(message)
    this.name = 'SyncCryptoError'
    this.kind = kind
    Object.setPrototypeOf(this, SyncCryptoError.prototype)
  }

  static encrypt(detail: string): SyncCryptoError {
    return new SyncCryptoError('encrypt', `加密失败: ${detail}`)
  }

  static decrypt(): SyncCryptoError {
    return new SyncCryptoError('decrypt', '解密失败（同步密码错误或数据损坏）')
  }

  static malformed(detail: string): SyncCryptoError {
    return new SyncCryptoError('malformed', `WrappedKey 格式非法: ${detail}`)
  }
}

/** Persisted wrapped-key form (all base64). Uploaded to WebDAV as master.key.enc. */
export interface WrappedKey {
  version: number
  /** Corresponds to credentials.key_id; used to write the key back to the KMS. */
  keyId: string
  salt: string
  nonce: string
  ciphertext: string
}

/** Derive a 32-byte DEK from the sync password + salt via PBKDF2-HMAC-SHA256. */
async function deriveDek(syncPassword: string, salt: Buffer): Promise<Buffer> {
  return pbkdf2Async(
    Buffer.from(syncPassword, 'utf8'),
    salt,
    PBKDF2_ITERATIONS,
    KEY_LEN,
    'sha256',
  )
}

/**
 * Build the GCM associated data binding version + keyId. encrypt/decrypt MUST
 * use the identical construction; tampering keyId on the remote breaks decrypt.
 */
function buildAad(version: number, keyId: string): Buffer {
  return Buffer.from(`v${version}:${keyId}`, 'utf8')
}

/** Wrap the master key under the sync password. keyId is recorded + AAD-bound. */
export async function wrapMasterKey(
  syncPassword: string,
  keyId: string,
  masterKey: Buffer,
): Promise<WrappedKey> {
  if (masterKey.length !== KEY_LEN) {
    throw SyncCryptoError.encrypt(`master key 长度必须为 ${KEY_LEN}`)
  }
  const salt = randomBytes(SALT_LEN)
  const nonce = randomBytes(NONCE_LEN)
  const dek = await deriveDek(syncPassword, salt)
  const aad = buildAad(WRAPPED_KEY_VERSION, keyId)

  try {
    const cipher = createCipheriv('aes-256-gcm', dek, nonce)
    cipher.setAAD(aad)
    const enc = Buffer.concat([cipher.update(masterKey), cipher.final()])
    const tag = cipher.getAuthTag()
    // Rust's aes-gcm appends the 16-byte tag to the ciphertext; match that so
    // master.key.enc is byte-compatible across the two implementations.
    const ciphertext = Buffer.concat([enc, tag])
    return {
      version: WRAPPED_KEY_VERSION,
      keyId,
      salt: salt.toString('base64'),
      nonce: nonce.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    }
  } catch (e) {
    throw SyncCryptoError.encrypt((e as Error).message)
  }
}

/** Unwrap the master key; returns { keyId, key }. Wrong password → decrypt error. */
export async function unwrapMasterKey(
  syncPassword: string,
  wrapped: WrappedKey,
): Promise<{ keyId: string; key: Buffer }> {
  if (wrapped.version !== WRAPPED_KEY_VERSION) {
    throw SyncCryptoError.malformed(`unsupported version ${wrapped.version}`)
  }
  const salt = decodeBase64(wrapped.salt, 'salt')
  const nonce = decodeBase64(wrapped.nonce, 'nonce')
  const combined = decodeBase64(wrapped.ciphertext, 'ciphertext')
  if (nonce.length !== NONCE_LEN) {
    throw SyncCryptoError.malformed('nonce length')
  }
  // The GCM tag is the last 16 bytes (Rust aes-gcm layout).
  if (combined.length < 16) {
    throw SyncCryptoError.malformed('ciphertext too short')
  }
  const tag = combined.subarray(combined.length - 16)
  const ciphertext = combined.subarray(0, combined.length - 16)

  const dek = await deriveDek(syncPassword, salt)
  // AAD must match the wrapping (binds version + keyId). Remote keyId tampering
  // makes decrypt fail rather than return a mismatched key.
  const aad = buildAad(wrapped.version, wrapped.keyId)

  let plaintext: Buffer
  try {
    const decipher = createDecipheriv('aes-256-gcm', dek, nonce)
    decipher.setAAD(aad)
    decipher.setAuthTag(tag)
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  } catch {
    throw SyncCryptoError.decrypt()
  }
  if (plaintext.length !== KEY_LEN) {
    throw SyncCryptoError.malformed('master key length')
  }
  return { keyId: wrapped.keyId, key: plaintext }
}

function decodeBase64(value: string, field: string): Buffer {
  // Node's base64 decoder is lenient; detect garbage by round-tripping.
  const buf = Buffer.from(value, 'base64')
  if (buf.toString('base64').replace(/=+$/, '') !== value.replace(/=+$/, '')) {
    throw SyncCryptoError.malformed(`${field}: invalid base64`)
  }
  return buf
}
