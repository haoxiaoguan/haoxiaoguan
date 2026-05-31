import { randomUUID } from 'node:crypto'
import type { JsonValue } from '../../account/domain/platform-account-profile'
import type { PlatformId } from '../../account/domain/platform-id'

// CredentialEnvelope domain — the persisted, encrypted form of a credential.
//
// IMPORTANT (spec §5.2 + CONVENTIONS): the Electron port uses the platform
// CryptoService whose AAD is the JSON bytes of {provider, accountId, createdAt}
// (NOT Rust bincode). There is no data-compat requirement with old Tauri
// envelopes, so we adopt the portable platform envelope shape rather than
// re-implementing bincode. The persisted JSON column (`envelope_json`) wraps the
// platform CryptoService envelope plus its AAD so decryption is self-contained:
//
//   { aad: { provider, accountId, createdAt }, envelope: { v, iv, ciphertext, tag } }
//
// This is byte-for-byte the same wrapper the account context's TEMP
// MikroOrmCredentialStore writes, so existing account rows round-trip unchanged
// once this context's repository replaces the temp store.

export const ENVELOPE_VERSION = 1

/** Master-key identifier. UUID v4, globally unique. */
export class KeyId {
  readonly value: string
  constructor(value: string) {
    this.value = value
  }
  static create(): KeyId {
    return new KeyId(randomUUID())
  }
  toString(): string {
    return this.value
  }
}

/** Decrypted payload (plaintext). JSON-serialised before AES-GCM encryption. */
export interface EncryptedPayload {
  access_token: string
  refresh_token?: string
  expires_at?: string
  raw_metadata?: JsonValue
}

/** AAD bound into the GCM tag — any field change invalidates the ciphertext. */
export interface EnvelopeAad {
  provider: string
  accountId: string
  createdAt: string
}

/** Platform CryptoService envelope shape ({ v, iv, ciphertext, tag } base64). */
export interface CryptoEnvelope {
  v: 1
  iv: string
  ciphertext: string
  tag: string
}

/**
 * Persisted envelope wrapper. This is exactly what gets JSON-stringified into the
 * credentials.envelope_json column and parsed back on read.
 */
export interface StoredEnvelope {
  aad: EnvelopeAad
  envelope: CryptoEnvelope
}

export function buildAad(provider: PlatformId, accountId: string, createdAt: string): EnvelopeAad {
  return { provider, accountId, createdAt }
}
