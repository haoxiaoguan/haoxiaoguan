// PlatformAccountProfile value object — 对应 PlatformAccountProfile.
//
// Carries the platform-specific identity + sanitized metadata derived from raw
// import material. identity_key is always lowercased+trimmed; the payload must
// be a plain object (token fields already stripped by the profile derivation).

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue }

export interface PlatformProfileFields {
  identityKey: string
  displayIdentifier: string
  loginProvider?: string
  planName?: string
  planTier?: string
  status?: string
  statusReason?: string
  profilePayload: JsonValue
}

function normalizeIdentityKey(value: string): string {
  // Rust: value.trim().to_ascii_lowercase()
  return value.trim().toLowerCase()
}

function normalizeOptional(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  return trimmed.length === 0 ? undefined : trimmed
}

function isPlainObject(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export class PlatformAccountProfile {
  identityKey: string
  displayIdentifier: string
  loginProvider?: string
  planName?: string
  planTier?: string
  status?: string
  statusReason?: string
  profilePayload: JsonValue

  constructor(fields: PlatformProfileFields) {
    this.identityKey = fields.identityKey
    this.displayIdentifier = fields.displayIdentifier
    this.loginProvider = fields.loginProvider
    this.planName = fields.planName
    this.planTier = fields.planTier
    this.status = fields.status
    this.statusReason = fields.statusReason
    this.profilePayload = fields.profilePayload
  }

  /** Build a bare profile from a single identifier (source from_identifier). */
  static fromIdentifier(identifier: string): PlatformAccountProfile {
    const normalized = normalizeIdentityKey(identifier)
    return new PlatformAccountProfile({
      identityKey: normalized,
      displayIdentifier: identifier.trim(),
      profilePayload: {},
    })
  }

  /**
   * Normalize against a fallback identifier (source `normalized`). Empty
   * identity/display fall back to the email; non-object payload becomes {}.
   */
  normalized(fallbackIdentifier: string): PlatformAccountProfile {
    if (this.identityKey.trim().length === 0) {
      this.identityKey = normalizeIdentityKey(fallbackIdentifier)
    } else {
      this.identityKey = normalizeIdentityKey(this.identityKey)
    }
    if (this.displayIdentifier.trim().length === 0) {
      this.displayIdentifier = fallbackIdentifier.trim()
    } else {
      this.displayIdentifier = this.displayIdentifier.trim()
    }
    if (!isPlainObject(this.profilePayload)) {
      this.profilePayload = {}
    }
    this.loginProvider = normalizeOptional(this.loginProvider)
    this.planName = normalizeOptional(this.planName)
    this.planTier = normalizeOptional(this.planTier)
    this.status = normalizeOptional(this.status)
    this.statusReason = normalizeOptional(this.statusReason)
    return this
  }
}
