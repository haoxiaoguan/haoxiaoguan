// Antigravity unified-state protobuf codec — faithful TS port of cockpit-tools
// crates/cockpit-core/src/utils/protobuf.rs.
//
// Antigravity stores its login in state.vscdb PLAIN keys (base64 protobuf), not
// SecretStorage:
//   antigravityUnifiedStateSync.oauthToken  → Topic{ data: [ Entry{f1:key, f2:Row{f1:base64(payload)}} ] }
//     entry "oauthTokenInfoSentinelKey".payload = OAuthTokenInfo protobuf:
//       f1 access_token, f2 token_type("Bearer"), f3 refresh_token,
//       f4 { f1: expiry_unix_seconds }, f5 id_token?, f6 is_gcp_tos?
//   antigravityUnifiedStateSync.userStatus  → same Topic shape,
//     entry "userStatusSentinelKey".payload = UserStatus protobuf:
//       f3 name, f7 email, f36 { f1 tier_id, f2/f3 plan_name }
//
// Only the wire pieces we need are decoded/encoded; unknown fields are skipped
// (decode) or preserved by rebuilding the topic entry-by-entry (encode/replace).

export interface WireField {
  field: number
  wire: number
  bytes?: Buffer
  varint?: bigint
}

export function readVarint(data: Buffer, offset: number): { value: bigint; next: number } {
  let result = 0n
  let shift = 0n
  let pos = offset
  for (;;) {
    if (pos >= data.length) throw new Error('protobuf: truncated varint')
    const byte = data[pos]
    pos += 1
    result |= BigInt(byte & 0x7f) << shift
    if ((byte & 0x80) === 0) break
    shift += 7n
    if (shift > 63n) throw new Error('protobuf: varint too long')
  }
  return { value: result, next: pos }
}

// Read all top-level fields of a protobuf message.
export function readFields(data: Buffer): WireField[] {
  const out: WireField[] = []
  let offset = 0
  while (offset < data.length) {
    const { value: tag, next } = readVarint(data, offset)
    offset = next
    const field = Number(tag >> 3n)
    const wire = Number(tag & 7n)
    if (field === 0) throw new Error('protobuf: zero field number')
    if (wire === 2) {
      const { value: len, next: contentOffset } = readVarint(data, offset)
      const length = Number(len)
      if (contentOffset + length > data.length) throw new Error('protobuf: truncated length-delimited')
      out.push({ field, wire, bytes: data.subarray(contentOffset, contentOffset + length) })
      offset = contentOffset + length
    } else if (wire === 0) {
      const { value, next: n2 } = readVarint(data, offset)
      out.push({ field, wire, varint: value })
      offset = n2
    } else if (wire === 5) {
      offset += 4
    } else if (wire === 1) {
      offset += 8
    } else {
      throw new Error(`protobuf: unknown wire type ${wire}`)
    }
  }
  return out
}

function firstBytes(fields: WireField[], field: number): Buffer | undefined {
  return fields.find((f) => f.field === field && f.bytes !== undefined)?.bytes
}

export function extractStringField(data: Buffer, field: number): string | undefined {
  const bytes = firstBytes(readFields(data), field)
  return bytes !== undefined ? bytes.toString('utf8') : undefined
}

// Locate a topic entry payload by sentinel key. Topic = { f1: Entry }* where
// Entry = { f1: key, f2: Row{ f1: base64(payload) } }.
function extractTopicEntryPayload(topic: Buffer, sentinelKey: string): Buffer | undefined {
  for (const entryField of readFields(topic)) {
    if (entryField.field !== 1 || entryField.bytes === undefined) continue
    const entry = readFields(entryField.bytes)
    const key = firstBytes(entry, 1)?.toString('utf8')
    if (key !== sentinelKey) continue
    const row = firstBytes(entry, 2)
    if (row === undefined) continue
    const b64 = firstBytes(readFields(row), 1)?.toString('utf8')
    if (b64 === undefined) continue
    try {
      return Buffer.from(b64, 'base64')
    } catch {
      return undefined
    }
  }
  return undefined
}

export interface AntigravityOAuthTokenInfo {
  accessToken: string
  tokenType?: string | undefined
  refreshToken?: string | undefined
  expiryUnixSeconds?: number | undefined
}

export function parseOAuthTokenInfo(oauthTokenBlob: Buffer): AntigravityOAuthTokenInfo | undefined {
  const payload = extractTopicEntryPayload(oauthTokenBlob, 'oauthTokenInfoSentinelKey')
  if (payload === undefined) return undefined
  const fields = readFields(payload)
  const accessToken = firstBytes(fields, 1)?.toString('utf8')
  if (accessToken === undefined || accessToken.length === 0) return undefined
  const tokenType = firstBytes(fields, 2)?.toString('utf8')
  const refreshToken = firstBytes(fields, 3)?.toString('utf8')
  const expiryMsg = firstBytes(fields, 4)
  let expiryUnixSeconds: number | undefined
  if (expiryMsg !== undefined) {
    const inner = readFields(expiryMsg)
    const secs = inner.find((f) => f.field === 1 && f.varint !== undefined)?.varint
    if (secs !== undefined) expiryUnixSeconds = Number(secs)
  }
  return { accessToken, tokenType, refreshToken, expiryUnixSeconds }
}

export interface AntigravityUserStatus {
  email?: string | undefined
  name?: string | undefined
  planTierId?: string | undefined
  planName?: string | undefined
}

export function parseUserStatus(userStatusBlob: Buffer): AntigravityUserStatus | undefined {
  const payload = extractTopicEntryPayload(userStatusBlob, 'userStatusSentinelKey')
  if (payload === undefined) return undefined
  const fields = readFields(payload)
  const name = firstBytes(fields, 3)?.toString('utf8')
  const email = firstBytes(fields, 7)?.toString('utf8')
  let planTierId: string | undefined
  let planName: string | undefined
  const planMsg = firstBytes(fields, 36)
  if (planMsg !== undefined) {
    const inner = readFields(planMsg)
    planTierId = firstBytes(inner, 1)?.toString('utf8')
    planName = firstBytes(inner, 2)?.toString('utf8') ?? firstBytes(inner, 3)?.toString('utf8')
  }
  return { email, name, planTierId, planName }
}

// --- encode (for switch injection) — mirrors utils/protobuf.rs ---

export function encodeVarint(value: number | bigint): Buffer {
  let v = BigInt(value)
  const bytes: number[] = []
  while (v >= 0x80n) {
    bytes.push(Number((v & 0x7fn) | 0x80n))
    v >>= 7n
  }
  bytes.push(Number(v))
  return Buffer.from(bytes)
}

export function encodeLenDelimField(fieldNum: number, data: Buffer): Buffer {
  const tag = (fieldNum << 3) | 2
  return Buffer.concat([encodeVarint(tag), encodeVarint(data.length), data])
}

export function encodeStringField(fieldNum: number, value: string): Buffer {
  return encodeLenDelimField(fieldNum, Buffer.from(value, 'utf8'))
}

export function encodeVarintField(fieldNum: number, value: number | bigint): Buffer {
  const tag = (fieldNum << 3) | 0
  return Buffer.concat([encodeVarint(tag), encodeVarint(value)])
}

// Build an OAuthTokenInfo protobuf (access/type/refresh/expiry [+id_token]).
export function createOAuthInfo(
  accessToken: string,
  refreshToken: string,
  expiryUnixSeconds: number,
  idToken?: string,
): Buffer {
  const timestampMsg = Buffer.concat([
    encodeVarint((1 << 3) | 0),
    encodeVarint(expiryUnixSeconds),
    encodeVarintField(2, 0),
  ])
  const parts = [
    encodeStringField(1, accessToken),
    encodeStringField(2, 'Bearer'),
    encodeStringField(3, refreshToken),
    encodeLenDelimField(4, timestampMsg),
  ]
  if (idToken !== undefined && idToken.trim().length > 0) {
    parts.push(encodeStringField(5, idToken))
  }
  return Buffer.concat(parts)
}

// Build a unified-state Topic entry: { f1: { f1:sentinelKey, f2:{ f1:base64(payload) } } }.
export function createUnifiedTopicEntry(sentinelKey: string, payload: Buffer): Buffer {
  const row = encodeStringField(1, payload.toString('base64'))
  const entry = Buffer.concat([encodeStringField(1, sentinelKey), encodeLenDelimField(2, row)])
  return encodeLenDelimField(1, entry)
}

// Remove a topic entry (by sentinel key), preserving all other rows — used by
// injection to replace one sentinel while keeping the rest of the topic intact.
export function removeUnifiedTopicEntry(topic: Buffer, targetKey: string): Buffer {
  const kept: Buffer[] = []
  for (const entryField of readFields(topic)) {
    if (entryField.field === 1 && entryField.bytes !== undefined) {
      const key = firstBytes(readFields(entryField.bytes), 1)?.toString('utf8')
      if (key === targetKey) continue
      kept.push(encodeLenDelimField(1, entryField.bytes))
    }
  }
  return Buffer.concat(kept)
}

export function createMinimalUserStatusPayload(email: string): Buffer {
  return Buffer.concat([encodeStringField(3, email), encodeStringField(7, email)])
}
