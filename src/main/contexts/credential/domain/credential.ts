import type { JsonValue } from '../../account/domain/platform-account-profile'

// Credential value object — decrypted secret material for an account.
//
// The JSON form uses snake_case (token / refresh_token / expires_at /
// raw_metadata; expires_at is RFC3339). This is byte-for-byte identical to the
// account context's Credential.toJson() so the credential repository here is a
// drop-in replacement for the account context's TEMP credential store.

export interface CredentialJson {
  token: string
  refresh_token?: string
  expires_at?: string
  raw_metadata?: JsonValue
}

export class Credential {
  readonly token: string
  readonly refreshToken?: string | undefined
  readonly expiresAt?: Date | undefined
  readonly rawMetadata?: JsonValue | undefined

  constructor(token: string, refreshToken?: string, expiresAt?: Date, rawMetadata?: JsonValue) {
    this.token = token
    this.refreshToken = refreshToken
    this.expiresAt = expiresAt
    this.rawMetadata = rawMetadata
  }

  /** True if expires_at is set and now >= it. */
  isExpired(): boolean {
    if (!this.expiresAt) return false
    return new Date() >= this.expiresAt
  }

  toJson(): CredentialJson {
    const out: CredentialJson = { token: this.token }
    if (this.refreshToken !== undefined) out.refresh_token = this.refreshToken
    if (this.expiresAt !== undefined) out.expires_at = this.expiresAt.toISOString()
    if (this.rawMetadata !== undefined) out.raw_metadata = this.rawMetadata
    return out
  }

  static fromJson(raw: CredentialJson): Credential {
    return new Credential(
      raw.token,
      raw.refresh_token ?? undefined,
      raw.expires_at ? new Date(raw.expires_at) : undefined,
      raw.raw_metadata ?? undefined,
    )
  }
}
