// Batch credential parser for the account-import "card-key / batch" method.
// Accepts either a JSON array / single object, or one-per-line "card-key" rows:
//
//   email----password----RefreshToken----ClientId----ClientSecret[----provider]
//
// Delimiters tried in order: "----", Tab, then 2+ spaces. Blank lines and lines
// starting with "#" are ignored. Only RefreshToken (field 3) is required; rows
// without one are dropped. The pasted email password is parsed but intentionally
// NOT carried into the credential (it is never used by the import).

export interface ParsedCred {
  /** From the card-key's first field; informational only, never stored. */
  email?: string
  refreshToken: string
  clientId?: string
  clientSecret?: string
  region?: string
  /** BuilderId | Enterprise | Github | Google — drives auth-method resolution. */
  provider?: string
}

function str(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  return t.length > 0 ? t : undefined
}

/** Normalize one already-parsed object (JSON path) into a ParsedCred. */
function fromObject(o: Record<string, unknown>): ParsedCred | null {
  const refreshToken = str(o.refreshToken) ?? str(o.refresh_token)
  if (refreshToken === undefined) return null
  return {
    email: str(o.email) ?? str((o as { _email?: unknown })._email),
    refreshToken,
    clientId: str(o.clientId) ?? str(o.client_id),
    clientSecret: str(o.clientSecret) ?? str(o.client_secret),
    region: str(o.region),
    provider: str(o.provider),
  }
}

/**
 * Split a single card-key line. Delimiter precedence: "----" > Tab > 2+ spaces.
 *
 * refreshToken / clientSecret are base64url(JWT) and may END with "-". When such
 * a value abuts the "----" delimiter it forms 5+ consecutive "-". A naive
 * split('----') eats only the first 4, truncating the JWT (→ 401 Bad
 * credentials) and prepending a stray "-" to the next field (→ provider becomes
 * "-BuilderId" → auth method mis-detected). So we match the delimiter as
 * /-{4,}/ and give the extra (N-4) dashes back to the PRECEDING field.
 */
function splitLine(line: string): string[] {
  if (line.includes('----')) {
    const parts: string[] = []
    const re = /-{4,}/g
    let last = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(line)) !== null) {
      parts.push(line.slice(last, m.index) + '-'.repeat(m[0].length - 4))
      last = m.index + m[0].length
    }
    parts.push(line.slice(last))
    return parts
  }
  if (line.includes('\t')) return line.split('\t')
  return line.split(/\s{2,}/)
}

/** Parse one card-key line: email----pwd----RT----CID----CSECRET[----provider]. */
function fromCardKey(line: string): ParsedCred | null {
  const parts = splitLine(line)
  const refreshToken = str(parts[2])
  if (refreshToken === undefined) return null
  const clientId = str(parts[3])
  const clientSecret = str(parts[4])
  // Field 6 (provider) explicit wins; otherwise infer: social logins
  // (Github/Google) carry only a refreshToken, IdC carries clientId/secret.
  const provider = str(parts[5]) ?? (clientId === undefined && clientSecret === undefined ? 'Google' : 'BuilderId')
  return {
    email: str(parts[0]),
    refreshToken,
    clientId,
    clientSecret,
    provider,
  }
}

/**
 * Parse pasted batch text into credential rows. Tries JSON (array or single
 * object) first; on failure, parses line-by-line card-key rows. Returns only
 * rows that carry a refreshToken.
 */
export function parseCredentialBatch(text: string): ParsedCred[] {
  const trimmed = text.trim()
  if (trimmed.length === 0) return []

  // JSON path: array or single object.
  try {
    const parsed: unknown = JSON.parse(trimmed)
    const list = Array.isArray(parsed) ? parsed : [parsed]
    return list
      .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
      .map(fromObject)
      .filter((c): c is ParsedCred => c !== null)
  } catch {
    // Not JSON — fall through to card-key parsing.
  }

  return trimmed
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'))
    .map(fromCardKey)
    .filter((c): c is ParsedCred => c !== null)
}

/**
 * Project a ParsedCred into the JSON string the single-account token-JSON import
 * (credentialService.importTokenJson) accepts. The email password is never
 * included; nor is the card-key email — identity is confirmed online during
 * enrichment, so the pasted email must never become the stored identity. Omits
 * empty optional fields.
 */
export function toTokenJson(cred: ParsedCred): string {
  const out: Record<string, string> = { refreshToken: cred.refreshToken }
  if (cred.clientId !== undefined) out.clientId = cred.clientId
  if (cred.clientSecret !== undefined) out.clientSecret = cred.clientSecret
  if (cred.region !== undefined) out.region = cred.region
  if (cred.provider !== undefined) out.provider = cred.provider
  return JSON.stringify(out)
}

// ---------------------------------------------------------------------------
// Unified batch parsing — the merged "Token/卡密" import mode.
//
// One textarea accepts, auto-detected:
//   1. a single token JSON object (e.g. cpa format: id_token/access_token/
//      refresh_token/account_id/last_refresh/email/type/expired)
//   2. a JSON array of such objects
//   3. card-key rows, one per line (same grammar as parseCredentialBatch)
//
// Unlike the legacy ParsedCred JSON path (which keeps only refreshToken/
// clientId/...), JSON objects are passed through VERBATIM to importTokenJson so
// cpa fields like id_token / account_id survive into raw_metadata.
// Unparsable entries are returned in `invalid` so the UI can count failures.
// ---------------------------------------------------------------------------

export interface UnifiedBatchItem {
  /** JSON string ready for credentialService.importTokenJson. */
  payload: string
  /** Human label for per-row error reporting (email or #index). */
  label: string
}

export interface UnifiedBatchParse {
  items: UnifiedBatchItem[]
  /** Entries that could not be parsed — pre-counted as failures by the UI. */
  invalid: string[]
}

/** True if the object carries any access/refresh token spelling (top level or under `tokens`). */
function hasTokenMaterial(o: Record<string, unknown>): boolean {
  const direct = [o.access_token, o.accessToken, o.token, o.refresh_token, o.refreshToken]
  if (direct.some((v) => typeof v === 'string' && v.trim().length > 0)) return true
  const nested = o.tokens
  if (typeof nested === 'object' && nested !== null && !Array.isArray(nested)) {
    const n = nested as Record<string, unknown>
    return [n.access_token, n.accessToken, n.refresh_token, n.refreshToken].some(
      (v) => typeof v === 'string' && v.trim().length > 0,
    )
  }
  return false
}

export function parseUnifiedBatch(text: string): UnifiedBatchParse {
  const trimmed = text.trim()
  const out: UnifiedBatchParse = { items: [], invalid: [] }
  if (trimmed.length === 0) return out

  // JSON path: single object or array of objects, passed through verbatim.
  try {
    const parsed: unknown = JSON.parse(trimmed)
    const list = Array.isArray(parsed) ? parsed : [parsed]
    list.forEach((el, i) => {
      if (el === null || typeof el !== 'object' || Array.isArray(el)) {
        out.invalid.push(`#${i + 1}: not a JSON object`)
        return
      }
      const obj = el as Record<string, unknown>
      const label = str(obj.email) ?? `#${i + 1}`
      if (!hasTokenMaterial(obj)) {
        out.invalid.push(`${label}: missing access_token/refresh_token`)
        return
      }
      out.items.push({ payload: JSON.stringify(obj), label })
    })
    return out
  } catch {
    // Not JSON — fall through to card-key rows.
  }

  trimmed.split('\n').forEach((rawLine, lineNo) => {
    const line = rawLine.trim()
    if (line.length === 0 || line.startsWith('#')) return
    const cred = fromCardKey(line)
    if (cred === null) {
      out.invalid.push(`line ${lineNo + 1}: unparsable card-key row (missing RefreshToken)`)
      return
    }
    out.items.push({ payload: toTokenJson(cred), label: cred.email ?? `line ${lineNo + 1}` })
  })
  return out
}
