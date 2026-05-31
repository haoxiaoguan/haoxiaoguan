import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { safeStorage } from 'electron'
import { appDataDir } from '../persistence/paths'

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

// Loads (or creates) the 32-byte master key, persisted with Electron safeStorage.
// Static imports only: the bytecode (.cjsc) bundle has no dynamic-import callback,
// so `await import(...)` throws ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING at runtime.
export async function loadOrCreateMasterKey(): Promise<Buffer> {
  const keyFile = join(appDataDir(), 'master.key.enc')
  try {
    const enc = await readFile(keyFile)
    if (safeStorage.isEncryptionAvailable()) {
      const b64 = safeStorage.decryptString(enc)
      const key = Buffer.from(b64, 'base64')
      if (key.length === 32) return key
    }
  } catch {
    // fall through to create
  }
  const key = randomBytes(32)
  await mkdir(appDataDir(), { recursive: true })
  if (safeStorage.isEncryptionAvailable()) {
    await writeFile(keyFile, safeStorage.encryptString(key.toString('base64')))
  } else {
    // Fallback parity with source (degraded): persist raw base64.
    await writeFile(keyFile, key.toString('base64'), 'utf8')
  }
  return key
}
