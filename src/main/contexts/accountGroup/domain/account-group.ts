// AccountGroup domain — cross-platform account collections.
//
// An AccountGroup is independent of platform: a single group can hold accounts
// from any agent (cursor, codex, gemini-cli, …). Membership is many-to-many
// (one account may live in multiple groups). A group MAY be bound to a single
// outbound proxy (or proxy-group); when bound, every member account routes its
// outbound HTTP through that proxy.
//
// Invariants:
//   - name: 1..64 bytes, trimmed (mirrors AccountName)
//   - color: optional, must be a 7-char #RRGGBB token if set
//   - description: optional, max 256 bytes (mirrors Notes)

const NAME_MAX = 64
const DESCRIPTION_MAX = 256
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

const encoder = new TextEncoder()
function byteLen(value: string): number {
  return encoder.encode(value).length
}

export interface AccountGroup {
  id: string
  name: string
  color?: string | undefined
  description?: string | undefined
  createdAt: Date
  updatedAt: Date
}

export interface AccountGroupMembership {
  groupId: string
  accountId: string
  createdAt: Date
}

/**
 * Where an AccountGroup is currently routed when its members talk to upstream
 * APIs. Exactly one of proxyId / proxyGroupId is set when bound; both undefined
 * means "no group-level routing override" (the member account falls back to its
 * own per-account binding, then to direct).
 */
export interface AccountGroupProxyBinding {
  groupId: string
  proxyId?: string | undefined
  createdAt: Date
}

export class AccountGroupError extends Error {
  constructor(
    public readonly kind:
      | 'not_found'
      | 'duplicate_name'
      | 'invalid_name'
      | 'invalid_color'
      | 'invalid_description'
      | 'in_use'
      | 'storage_error'
      | 'internal',
    message: string,
  ) {
    super(message)
    this.name = 'AccountGroupError'
  }

  static notFound(id: string): AccountGroupError {
    return new AccountGroupError('not_found', `AccountGroup '${id}' not found`)
  }
  static duplicateName(name: string): AccountGroupError {
    return new AccountGroupError('duplicate_name', `AccountGroup '${name}' already exists`)
  }
  static invalidName(reason: string): AccountGroupError {
    return new AccountGroupError('invalid_name', reason)
  }
  static invalidColor(value: string): AccountGroupError {
    return new AccountGroupError('invalid_color', `invalid color '${value}' (need #RRGGBB)`)
  }
  static invalidDescription(reason: string): AccountGroupError {
    return new AccountGroupError('invalid_description', reason)
  }
  static inUse(groupId: string, members: number): AccountGroupError {
    return new AccountGroupError(
      'in_use',
      `AccountGroup '${groupId}' still has ${members} members`,
    )
  }
  static storageError(reason: string): AccountGroupError {
    return new AccountGroupError('storage_error', `storage: ${reason}`)
  }
  static internal(reason: string): AccountGroupError {
    return new AccountGroupError('internal', reason)
  }
}

/** Validate-and-normalize the user-facing group name. */
export function normalizeAccountGroupName(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.length === 0) {
    throw AccountGroupError.invalidName('name must not be empty')
  }
  const len = byteLen(trimmed)
  if (len > NAME_MAX) {
    throw AccountGroupError.invalidName(`name must be <= ${NAME_MAX} bytes (got ${len})`)
  }
  return trimmed
}

/** Validate the hex color token. Empty string is treated as "unset". */
export function normalizeAccountGroupColor(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined
  const trimmed = raw.trim()
  if (trimmed === '') return undefined
  if (!HEX_COLOR.test(trimmed)) {
    throw AccountGroupError.invalidColor(trimmed)
  }
  return trimmed.toLowerCase()
}

/** Validate the optional description. Empty string is treated as "unset". */
export function normalizeAccountGroupDescription(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined
  const trimmed = raw.trim()
  if (trimmed === '') return undefined
  const len = byteLen(trimmed)
  if (len > DESCRIPTION_MAX) {
    throw AccountGroupError.invalidDescription(
      `description must be <= ${DESCRIPTION_MAX} bytes (got ${len})`,
    )
  }
  return trimmed
}
