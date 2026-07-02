import type { JsonValue } from '../../../account/domain/platform-account-profile'
import type { PlatformId } from '../../../account/domain/platform-id'
import type { LocalImportCapability } from '../../domain/capabilities'
import type { ImportedCredentialMaterial } from '../../domain/capability-types'
import { parseExpiresAt, pickString, stateVscdbPath } from '../scan-helpers'
import { decodeSecretStorageValue, type SafeStorageMode } from '../vscode-secret-storage'
import { buildSecretStorageItemKey, readVscdbItem } from '../vscdb-reader'

// CodeBuddy / CodeBuddy CN local-scan capability. The login session lives in
// state.vscdb as an encrypted SecretStorage item; the extension id / key differ
// between distributions AND client versions, so we probe candidates in order:
//   intl:  {tencent-cloud.coding-copilot, planning-genie.new.accessToken}
//          {tencent.planning-genie,       planning-genie.new.accessToken}
//   CN:    {tencent-cloud.coding-copilot, planning-genie.new.accessTokencn}
// (data dirs: "CodeBuddy" / "CodeBuddy CN"). Mirrors cockpit-tools
// codebuddy_account::import_payload_from_local: decrypted value is a session
// JSON (or a bare token string); tokens may be "uid+token" — the uid prefix is
// split off. rawMetadata mirrors the codebuddy OAuth capability / profile shape.

interface KeyCandidate {
  extensionId: string
  key: string
}

type Decode = (rawValue: string, mode: SafeStorageMode) => Promise<string>

const INTL_CANDIDATES: KeyCandidate[] = [
  { extensionId: 'tencent-cloud.coding-copilot', key: 'planning-genie.new.accessToken' },
  { extensionId: 'tencent.planning-genie', key: 'planning-genie.new.accessToken' },
]
const CN_CANDIDATES: KeyCandidate[] = [
  { extensionId: 'tencent-cloud.coding-copilot', key: 'planning-genie.new.accessTokencn' },
]

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

// parse_local_access_token：字符串直接用；对象依次 token/access_token/accessToken →
// auth.accessToken → session/data 递归；数组逐项。
function parseLocalAccessToken(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = parseLocalAccessToken(item)
      if (found !== undefined) return found
    }
    return undefined
  }
  const obj = asObject(value)
  if (obj === undefined) return undefined
  const direct = pickString(obj, [['token'], ['access_token'], ['accessToken']])
  if (direct) return direct
  const auth = pickString(obj, [
    ['auth', 'accessToken'],
    ['auth', 'access_token'],
  ])
  if (auth) return auth
  return parseLocalAccessToken(obj.session) ?? parseLocalAccessToken(obj.data)
}

// "uid+token" → [uid, token]；无 '+' 则 uid 为空。
function splitTokenParts(raw: string): { uid: string | undefined; token: string } | undefined {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return undefined
  const plus = trimmed.indexOf('+')
  if (plus >= 0) {
    const uid = trimmed.slice(0, plus).trim()
    const token = trimmed.slice(plus + 1).trim()
    if (token.length === 0) return undefined
    return { uid: uid.length > 0 ? uid : undefined, token }
  }
  return { uid: undefined, token: trimmed }
}

export class CodebuddyLocalImportCapability implements LocalImportCapability {
  private readonly candidates: KeyCandidate[]
  private readonly mode: SafeStorageMode

  constructor(
    private readonly platform: 'codebuddy' | 'codebuddy_cn',
    private readonly stateDbPathOverride?: string,
    private readonly decode: Decode = decodeSecretStorageValue,
  ) {
    this.candidates = platform === 'codebuddy_cn' ? CN_CANDIDATES : INTL_CANDIDATES
    this.mode = platform === 'codebuddy_cn' ? 'codebuddy_cn' : 'codebuddy'
  }

  provider(): PlatformId {
    return this.platform
  }

  private dbPath(): string {
    // 注意 CN 版目录带空格："CodeBuddy CN"。
    return (
      this.stateDbPathOverride ??
      stateVscdbPath(this.platform === 'codebuddy_cn' ? 'CodeBuddy CN' : 'CodeBuddy')
    )
  }

  async scanLocal(): Promise<ImportedCredentialMaterial[]> {
    const dbPath = this.dbPath()
    let secret: string | undefined
    for (const candidate of this.candidates) {
      const itemKey = buildSecretStorageItemKey(candidate.extensionId, candidate.key)
      const rawValue = readVscdbItem(dbPath, itemKey)
      if (!rawValue) continue
      try {
        secret = await this.decode(rawValue, this.mode)
        break
      } catch {
        continue
      }
    }
    if (secret === undefined) return []

    let parsed: Record<string, unknown> | undefined
    try {
      parsed = asObject(JSON.parse(secret))
    } catch {
      parsed = undefined
    }

    const rawToken = (parsed !== undefined ? parseLocalAccessToken(parsed) : undefined) ?? secret.trim()
    const parts = splitTokenParts(rawToken)
    if (parts === undefined) return []
    const accessToken = parts.token

    const account = asObject(parsed?.account)
    const auth = asObject(parsed?.auth)

    const uid =
      pickString(parsed, [['uid']]) ?? pickString(account, [['uid'], ['id']]) ?? parts.uid
    const nickname =
      pickString(parsed, [['nickname'], ['name']]) ?? pickString(account, [['nickname'], ['label']])
    const email =
      pickString(parsed, [['email']]) ??
      pickString(account, [['email']]) ??
      pickString(auth, [['email']]) ??
      nickname ??
      uid ??
      `${this.platform}-user`
    const enterpriseId =
      pickString(parsed, [['enterpriseId'], ['enterprise_id']]) ??
      pickString(account, [['enterpriseId'], ['enterprise_id']])
    const enterpriseName =
      pickString(parsed, [['enterpriseName'], ['enterprise_name']]) ??
      pickString(account, [['enterpriseName'], ['enterprise_name']])
    const refreshToken =
      pickString(parsed, [['refreshToken'], ['refresh_token']]) ??
      pickString(auth, [['refreshToken'], ['refresh_token']])
    const tokenType = pickString(parsed, [['tokenType'], ['token_type']]) ?? pickString(auth, [['tokenType']])
    const domain = pickString(parsed, [['domain']]) ?? pickString(auth, [['domain']])
    const expiresAt = parseExpiresAt(parsed?.expiresAt ?? auth?.expiresAt)

    const rawMetadata: JsonValue = {
      email,
      uid: uid ?? null,
      nickname: nickname ?? null,
      enterprise_id: enterpriseId ?? null,
      enterprise_name: enterpriseName ?? null,
      domain: domain ?? null,
      access_token: accessToken,
      refresh_token: refreshToken ?? null,
      token_type: tokenType ?? null,
      expires_at: expiresAt ? Math.floor(expiresAt.getTime() / 1000) : null,
      auth_raw: (parsed ?? null) as JsonValue,
      profile_raw: (account ?? null) as JsonValue,
    }

    return [
      {
        provider: this.platform,
        email,
        accessToken,
        refreshToken,
        expiresAt,
        source: 'local_scan',
        rawMetadata,
      },
    ]
  }
}
