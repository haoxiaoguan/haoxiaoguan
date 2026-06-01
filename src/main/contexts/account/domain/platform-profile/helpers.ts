import { createHash } from 'node:crypto'
import { PlatformAccountProfile, type JsonValue } from '../platform-account-profile'
import { type PlatformId, platformIdentityPrefix } from '../platform-id'

// Shared profile-derivation helpers. Faithful port of the source
// `platform_profile` mod.rs free functions. These operate on a JSON value tree
// (raw_metadata) using path lookups; numbers/strings/bools are coerced exactly
// as the Rust pick_* helpers do.

type JsonObject = { [key: string]: JsonValue }

export function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function emptyPayload(): JsonValue {
  return {}
}

// Resolve a path (object keys or numeric array indices) into the tree.
// Mirrors get_path_value.
export function getPathValue(root: JsonValue | undefined, path: string[]): JsonValue | undefined {
  if (root === undefined) return undefined
  let current: JsonValue = root
  for (const key of path) {
    if (isObject(current) && key in current) {
      current = current[key]
      continue
    }
    const index = Number.parseInt(key, 10)
    if (!Number.isNaN(index) && String(index) === key && Array.isArray(current)) {
      const next = current[index]
      if (next === undefined) return undefined
      current = next
      continue
    }
    return undefined
  }
  return current
}

export function normalizeNonEmpty(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed.length === 0 ? undefined : trimmed
}

// pick_string: first path yielding a non-empty string, or an integer coerced to
// its decimal string. Mirrors Rust (as_str→trim→non-empty; as_i64; as_u64).
export function pickString(root: JsonValue | undefined, paths: string[][]): string | undefined {
  if (root === undefined) return undefined
  for (const path of paths) {
    const value = getPathValue(root, path)
    if (value === undefined) continue
    if (typeof value === 'string') {
      const text = normalizeNonEmpty(value)
      if (text !== undefined) return text
    }
    if (typeof value === 'number' && Number.isInteger(value)) {
      return String(value)
    }
  }
  return undefined
}

// pick_number: first path yielding a finite f64, or a string parseable to one.
export function pickNumber(root: JsonValue | undefined, paths: string[][]): number | undefined {
  if (root === undefined) return undefined
  for (const path of paths) {
    const value = getPathValue(root, path)
    if (value === undefined) continue
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string') {
      const parsed = Number.parseFloat(value.trim())
      if (Number.isFinite(parsed)) return parsed
    }
  }
  return undefined
}

// pick_bool: first path yielding a bool, or a known truthy/falsy string token.
export function pickBool(root: JsonValue | undefined, paths: string[][]): boolean | undefined {
  if (root === undefined) return undefined
  for (const path of paths) {
    const value = getPathValue(root, path)
    if (value === undefined) continue
    if (typeof value === 'boolean') return value
    if (typeof value === 'string') {
      const text = value.trim().toLowerCase()
      if (text === 'true' || text === '1' || text === 'yes') return true
      if (text === 'false' || text === '0' || text === 'no') return false
    }
  }
  return undefined
}

// pick_value: first path yielding any value (cloned).
export function pickValue(root: JsonValue | undefined, paths: string[][]): JsonValue | undefined {
  if (root === undefined) return undefined
  for (const path of paths) {
    const value = getPathValue(root, path)
    if (value !== undefined) return structuredClone(value)
  }
  return undefined
}

export function commonStatus(raw: JsonValue | undefined): string | undefined {
  return pickString(raw, [['status'], ['accountStatus'], ['state'], ['userStatus']])
}

export function commonStatusReason(raw: JsonValue | undefined): string | undefined {
  return pickString(raw, [['statusReason'], ['status_reason'], ['reason'], ['message']])
}

// region_from_arn: the region segment of an AWS ARN
// (arn:aws:codewhisperer:<region>:<account>:...). Used to route Kiro's
// region-specific quota endpoints when no explicit region field is present.
export function regionFromArn(arn: string | undefined): string | undefined {
  if (arn === undefined) return undefined
  const segments = arn.split(':')
  if (segments[0]?.trim().toLowerCase() !== 'arn') return undefined
  const region = segments[3]?.trim()
  return region !== undefined && region.length > 0 ? region : undefined
}

// provider_from_login_option: map known login option tokens to display names.
export function providerFromLoginOption(loginOption: string): string | undefined {
  switch (loginOption.trim().toLowerCase()) {
    case 'google':
      return 'Google'
    case 'github':
      return 'Github'
    case 'builderid':
      return 'Builder ID'
    case 'awsidc':
      return 'AWS IDC'
    case '':
      return undefined
    default:
      return loginOption.trim()
  }
}

// sanitize_identifier_part: keep [a-z0-9._-], map separators to '-', cap 96,
// then trim leading/trailing '.', '-', '_'. Lowercased.
export function sanitizeIdentifierPart(raw: string): string {
  let out = ''
  for (const ch of raw.trim()) {
    if (/[a-zA-Z0-9]/.test(ch) || ch === '.' || ch === '_' || ch === '-') {
      out += ch.toLowerCase()
    } else if (/\s/.test(ch) || ch === ':' || ch === '/' || ch === '@' || ch === '|' || ch === '\\') {
      out += '-'
    }
    if (out.length >= 96) break
  }
  return out.replace(/^[.\-_]+/, '').replace(/[.\-_]+$/, '')
}

// short_hash: first 6 bytes of SHA-256, hex.
export function shortHash(value: string): string {
  const digest = createHash('sha256').update(value, 'utf8').digest()
  return digest.subarray(0, 6).toString('hex')
}

// md5 hex (used by codex storage id derivation).
export function md5Hex(value: string): string {
  return createHash('md5').update(value, 'utf8').digest('hex')
}

// normalized_identity_key: sanitize the identity; if empty, synthesize
// "{prefix}-{shortHash(token)}".
export function normalizedIdentityKey(
  platform: PlatformId,
  identity: string,
  tokenHint: string,
): string {
  const normalized = sanitizeIdentifierPart(identity)
  if (normalized.length === 0) {
    return `${platformIdentityPrefix(platform)}-${shortHash(tokenHint)}`
  }
  return normalized
}

// normalize_timestamp: drop <=0; convert ms→s when >10_000_000_000.
export function normalizeTimestamp(raw: number): number | undefined {
  if (raw <= 0) return undefined
  return raw > 10_000_000_000 ? Math.trunc(raw / 1000) : raw
}

// parse_timestamp: number/string seconds, ms, or RFC3339 → unix seconds.
export function parseTimestamp(value: JsonValue | undefined): number | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return normalizeTimestamp(value)
    if (Number.isFinite(value)) return normalizeTimestamp(Math.round(value))
    return undefined
  }
  if (typeof value === 'string') {
    const text = value.trim()
    if (text.length === 0) return undefined
    const asInt = Number.parseInt(text, 10)
    if (!Number.isNaN(asInt) && String(asInt) === text) return normalizeTimestamp(asInt)
    const ms = Date.parse(text)
    if (!Number.isNaN(ms)) return Math.trunc(ms / 1000)
  }
  return undefined
}

// decode_jwt_claims: base64url-decode the JWT payload segment, JSON.parse it.
export function decodeJwtClaims(token: string): JsonValue | undefined {
  const parts = token.split('.')
  if (parts.length < 2) return undefined
  const payload = parts[1]
  try {
    const decoded = Buffer.from(payload, 'base64url').toString('utf8')
    return JSON.parse(decoded) as JsonValue
  } catch {
    return undefined
  }
}

// is_sensitive_key: normalize to alnum-lowercase, check exact set + suffixes.
const SENSITIVE_EXACT = new Set([
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'authorization',
  'cookie',
  'password',
  'apikey',
  'openaiapikey',
  'githubaccesstoken',
  'copilottoken',
  'windsurfapikey',
  'windsurfauthtoken',
  'devinauth1token',
  'devinsessiontoken',
  'tokens',
  'sessionkey',
  'sessionsecret',
  'secret',
  'clientsecret',
  'codeverifier',
  'oauthstate',
  'state',
  'token',
])
const SENSITIVE_SUFFIXES = [
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'apikey',
  'authtoken',
  'sessiontoken',
]

export function isSensitiveKey(key: string): boolean {
  const normalized = key
    .split('')
    .filter((c) => /[a-zA-Z0-9]/.test(c))
    .join('')
    .toLowerCase()
  if (SENSITIVE_EXACT.has(normalized)) return true
  return SENSITIVE_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
}

// sanitize_provider_payload: recursively drop sensitive keys.
export function sanitizeProviderPayload(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(sanitizeProviderPayload)
  }
  if (isObject(value)) {
    const sanitized: JsonObject = {}
    for (const [key, child] of Object.entries(value)) {
      if (isSensitiveKey(key)) continue
      sanitized[key] = sanitizeProviderPayload(child)
    }
    return sanitized
  }
  return value
}

export function sanitizedPayload(raw: JsonValue | undefined): JsonValue {
  if (raw === undefined) return emptyPayload()
  return sanitizeProviderPayload(structuredClone(raw))
}

// upsert_payload_value: entry(key).or_insert — only inserts when key absent.
export function upsertPayloadValue(payload: { value: JsonValue }, key: string, value: JsonValue | undefined): void {
  if (value === undefined) return
  if (!isObject(payload.value)) {
    payload.value = emptyPayload()
  }
  const obj = payload.value as JsonObject
  if (!(key in obj)) {
    obj[key] = value
  }
}

export function upsertPayloadString(
  payload: { value: JsonValue },
  key: string,
  value: string | undefined,
): void {
  upsertPayloadValue(payload, key, value === undefined ? undefined : value)
}

export function upsertPayloadNumber(
  payload: { value: JsonValue },
  key: string,
  value: number | undefined,
): void {
  upsertPayloadValue(payload, key, value === undefined ? undefined : value)
}

export function upsertPayloadFromPath(
  payload: { value: JsonValue },
  key: string,
  raw: JsonValue | undefined,
  paths: string[][],
): void {
  const picked = pickValue(raw, paths)
  upsertPayloadValue(payload, key, picked === undefined ? undefined : sanitizeProviderPayload(picked))
}

// upsert_github_copilot_payload_fields — shared by github_copilot + windsurf.
export function upsertGithubCopilotPayloadFields(
  payload: { value: JsonValue },
  raw: JsonValue | undefined,
): void {
  upsertPayloadFromPath(payload, 'githubLogin', raw, [
    ['github_login'],
    ['githubLogin'],
    ['user', 'login'],
    ['login'],
  ])
  upsertPayloadFromPath(payload, 'githubId', raw, [
    ['github_id'],
    ['githubId'],
    ['user', 'id'],
    ['id'],
  ])
  upsertPayloadFromPath(payload, 'githubName', raw, [
    ['github_name'],
    ['githubName'],
    ['user', 'name'],
    ['name'],
  ])
  upsertPayloadFromPath(payload, 'githubEmail', raw, [
    ['github_email'],
    ['githubEmail'],
    ['user', 'email'],
    ['email'],
  ])
  upsertPayloadFromPath(payload, 'copilotPlan', raw, [
    ['copilot_plan'],
    ['copilotPlan'],
    ['plan', 'name'],
    ['subscription', 'name'],
  ])
  upsertPayloadFromPath(payload, 'copilotChatEnabled', raw, [
    ['copilot_chat_enabled'],
    ['copilotChatEnabled'],
  ])
  upsertPayloadFromPath(payload, 'copilotExpiresAt', raw, [
    ['copilot_expires_at'],
    ['copilotExpiresAt'],
  ])
  upsertPayloadFromPath(payload, 'copilotRefreshIn', raw, [
    ['copilot_refresh_in'],
    ['copilotRefreshIn'],
  ])
  upsertPayloadFromPath(payload, 'copilotQuotaSnapshots', raw, [
    ['copilot_quota_snapshots'],
    ['copilotQuotaSnapshots'],
  ])
  upsertPayloadFromPath(payload, 'copilotQuotaResetDate', raw, [
    ['copilot_quota_reset_date'],
    ['copilotQuotaResetDate'],
  ])
  upsertPayloadFromPath(payload, 'copilotLimitedUserQuotas', raw, [
    ['copilot_limited_user_quotas'],
    ['copilotLimitedUserQuotas'],
  ])
  upsertPayloadFromPath(payload, 'copilotLimitedUserResetDate', raw, [
    ['copilot_limited_user_reset_date'],
    ['copilotLimitedUserResetDate'],
  ])
}

export function upsertReferenceTimestamps(payload: { value: JsonValue }, raw: JsonValue | undefined): void {
  upsertPayloadFromPath(payload, 'quotaQueryLastError', raw, [
    ['quota_query_last_error'],
    ['quotaQueryLastError'],
  ])
  upsertPayloadFromPath(payload, 'quotaQueryLastErrorAt', raw, [
    ['quota_query_last_error_at'],
    ['quotaQueryLastErrorAt'],
  ])
  upsertPayloadFromPath(payload, 'usageUpdatedAt', raw, [['usage_updated_at'], ['usageUpdatedAt']])
}

// A mutable payload cell, so the upsert_* helpers can reassign when the value
// is not an object (mirrors Rust's `&mut Value`).
export type PayloadCell = { value: JsonValue }

export function makeProfile(fields: {
  identityKey: string
  displayIdentifier: string
  loginProvider?: string
  planName?: string
  planTier?: string
  status?: string
  statusReason?: string
  profilePayload: JsonValue
}): PlatformAccountProfile {
  return new PlatformAccountProfile(fields)
}
