import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { JsonValue } from '../../../account/domain/platform-account-profile'
import type { PlatformId } from '../../../account/domain/platform-id'
import type { LocalImportCapability } from '../../domain/capabilities'
import type { ImportedCredentialMaterial } from '../../domain/capability-types'
import { CredentialError } from '../../domain/credential-error'
import {
  appDataDir,
  homeDir,
  jwtClaimString,
  parseExpiresAt,
  pickString,
  stateVscdbPath,
} from '../scan-helpers'
import { readVscdbItem } from '../vscdb-reader'
import { enrichKiroMaterial } from './kiro-identity-enrichment'
import type { FetchImpl } from '../../../../platform/net/kiro/kiro-identity-client'

// Kiro local-scan capability — ported from quota/infrastructure/local/Rust模块.
//
// IMPORTANT: Kiro is an AWS-backed IDE, NOT a generic VSCode-SecretStorage app.
// Its credential lives in a PLAIN JSON file at
//   ~/.aws/sso/cache/kiro-auth-token.json
// (accessToken / refreshToken / expiresAt / email / userId / loginProvider), with
// the email/profile mirrored in Kiro's globalStorage profile.json and usage
// telemetry in the state.vscdb PLAIN item `kiro.kiroAgent` (not a secret:// blob).
//
// The earlier port wired Kiro to the generic VsCodeSecretLocalImportCapability,
// which looked for a non-existent secret:// SecretStorage entry and silently
// returned [] ("无法导入本地账号"). This dedicated reader matches the source.
//
// REGION / ENTERPRISE: Builder ID accounts pin us-east-1, but Enterprise (AWS
// IdC) accounts live in whatever region their IdC instance runs — and the live
// quota/refresh endpoints are region-routed. The token file carries the region
// explicitly (`region`, alongside `provider`/`authMethod`/`clientIdHash`); the
// CodeWhisperer profile ARN's 4th segment is the same region. We surface BOTH
// region and profileArn into rawMetadata so the profile builder can pin them
// onto profilePayload, and the quota fetcher can route to the right endpoint
// without guessing. When the well-known kiro-auth-token.json is absent (some
// Enterprise installs only write the <clientIdHash>.json pair), we fall back to
// scanning the cache dir for an IdC/Enterprise token file.

const LOCAL_USAGE_DB_KEY = 'kiro.kiroAgent'

export class KiroLocalImportCapability implements LocalImportCapability {
  constructor(
    private readonly authTokenPathOverride?: string,
    private readonly profilePathOverride?: string,
    private readonly stateDbPathOverride?: string,
    // When false (default), a failed live identity confirmation aborts the
    // import; when true, import proceeds with a placeholder identity. Accepts a
    // resolver so the live app setting (allow_stale_kiro_import) is read at scan
    // time; tests pass a plain boolean.
    private readonly allowStaleOption: boolean | (() => boolean) = false,
    // Injectable transport for the identity enrichment call (tests only).
    private readonly fetchImpl?: FetchImpl,
  ) {}

  private get allowStale(): boolean {
    return typeof this.allowStaleOption === 'function'
      ? this.allowStaleOption()
      : this.allowStaleOption
  }

  provider(): PlatformId {
    return 'kiro'
  }

  private authTokenPath(): string | undefined {
    if (this.authTokenPathOverride) return this.authTokenPathOverride
    const home = homeDir()
    if (!home) return undefined
    const cacheDir = join(home, '.aws', 'sso', 'cache')
    const wellKnown = join(cacheDir, 'kiro-auth-token.json')
    if (existsSync(wellKnown)) return wellKnown
    // Enterprise (IdC) installs may only write the <clientIdHash>.json token
    // pair without the well-known alias. Find the cache entry that looks like a
    // Kiro auth token (has accessToken + a refreshToken or clientIdHash) rather
    // than a bare OIDC client registration (clientId/clientSecret only).
    return findKiroTokenInCache(cacheDir)
  }

  private profilePath(): string {
    return (
      this.profilePathOverride ??
      join(appDataDir('Kiro'), 'User', 'globalStorage', 'kiro.kiroagent', 'profile.json')
    )
  }

  private stateDbPath(): string {
    return this.stateDbPathOverride ?? stateVscdbPath('Kiro')
  }

  async scanLocal(): Promise<ImportedCredentialMaterial[]> {
    const authPath = this.authTokenPath()
    if (!authPath) return []
    const authToken = readJsonObject(authPath)
    if (!authToken) return []

    const profile = readJsonObject(this.profilePath())
    const usage = readUsage(this.stateDbPath())

    const accessToken = pickString(authToken, [
      ['accessToken'],
      ['access_token'],
      ['token'],
      ['data', 'accessToken'],
    ])
    if (!accessToken) {
      throw CredentialError.invalidCredential('Kiro 本地授权文件缺少 accessToken')
    }

    const refreshToken = pickString(authToken, [
      ['refreshToken'],
      ['refresh_token'],
      ['data', 'refreshToken'],
    ])
    const idToken = pickString(authToken, [['idToken'], ['id_token']])

    const email =
      pickString(profile, [['userId'], ['user_id'], ['id'], ['email'], ['account', 'id']]) ??
      pickString(authToken, [['userId'], ['user_id'], ['email']]) ??
      // Enterprise (IdC) accounts have NO email/userId in profile.json or the
      // token file — their identity lives in the usage telemetry's userInfo.
      pickString(usage, [
        ['userInfo', 'email'],
        ['userInfo', 'userId'],
        ['email'],
      ]) ??
      (idToken ? jwtClaimString(idToken, 'email') : undefined) ??
      (idToken ? jwtClaimString(idToken, 'sub') : undefined) ??
      jwtClaimString(accessToken, 'sub') ??
      'kiro-user'

    const expiresAt = parseExpiresAt(
      authToken.expiresAt ?? authToken.expires_at ?? authToken.expiration,
    )

    const loginProvider =
      pickString(profile, [['loginProvider'], ['provider'], ['authProvider']]) ??
      pickString(authToken, [['login_option'], ['loginProvider']]) ??
      pickString(usage, [
        ['userInfo', 'provider', 'label'],
        ['userInfo', 'provider', 'name'],
        ['userInfo', 'loginProvider'],
      ])
    const userId =
      pickString(profile, [['userId'], ['user_id'], ['id'], ['sub']]) ??
      pickString(usage, [['userInfo', 'userId'], ['userInfo', 'user_id']]) ??
      (idToken ? jwtClaimString(idToken, 'sub') : undefined)

    // CodeWhisperer profile ARN — needed to route runtime usage requests. The
    // local profile.json stores it under `arn`; some token files mirror it too.
    const profileArn = pickString(profile, [['arn'], ['profileArn'], ['profile_arn']]) ??
      pickString(authToken, [['profileArn'], ['profile_arn'], ['arn']])

    // Region resolution (Enterprise accounts are NOT pinned to us-east-1):
    //   1. explicit `region` field in the token file (authoritative)
    //   2. the ARN's 4th segment (arn:aws:codewhisperer:<region>:...)
    // authMethod/provider distinguish Builder ID (Social) from Enterprise (IdC).
    const region =
      pickString(authToken, [['region'], ['ssoRegion'], ['sso_region']]) ??
      regionFromArn(profileArn)
    const authMethod = pickString(authToken, [['authMethod'], ['auth_method']])
    const provider = pickString(authToken, [['provider']])
    const clientIdHash = pickString(authToken, [['clientIdHash'], ['client_id_hash']])
    // The real OIDC clientId + clientSecret are NOT in the token file (it only
    // carries the clientIdHash). They live in the paired registration file
    // <clientIdHash>.json in the same cache dir. clientId is the enterprise
    // account identifier; clientSecret is needed to refresh IdC tokens.
    const registration = resolveRegistration(authPath, clientIdHash)
    const clientId =
      pickString(authToken, [['clientId'], ['client_id']]) ?? registration.clientId
    const clientSecret =
      pickString(authToken, [['clientSecret'], ['client_secret']]) ?? registration.clientSecret

    const rawMetadata: JsonValue = {
      email,
      user_id: userId ?? null,
      login_provider: loginProvider ?? null,
      region: region ?? null,
      auth_method: authMethod ?? null,
      provider: provider ?? null,
      client_id: clientId ?? null,
      client_id_hash: clientIdHash ?? null,
      // Sensitive: stripped from the plaintext profilePayload by
      // sanitizeProviderPayload ('clientsecret' is in its SENSITIVE_EXACT set),
      // but retained here so the encrypted credential can refresh IdC tokens.
      client_secret: clientSecret ?? null,
      profileArn: profileArn ?? null,
      accessToken,
      refreshToken: refreshToken ?? null,
      idToken: idToken ?? null,
      kiro_auth_token_raw: authToken as JsonValue,
      kiro_profile_raw: (profile ?? null) as JsonValue,
      kiro_usage_raw: (usage ?? null) as JsonValue,
    }

    const material: ImportedCredentialMaterial = {
      provider: 'kiro',
      email,
      accessToken,
      refreshToken,
      expiresAt,
      source: 'local_scan',
      rawMetadata,
    }

    // Enterprise (IdC) identity is not reliably on disk (local state can be a
    // stale leftover from a prior account). Confirm it live via getUsageLimits
    // before the material is used to derive the account identity. Voids the
    // stale local profile; aborts on failure unless allowStale is set.
    return [await enrichKiroMaterial(material, { allowStale: this.allowStale, fetchImpl: this.fetchImpl })]
  }
}

// read_json_file — parse a JSON object file, or undefined if absent/unreadable.
function readJsonObject(path: string): Record<string, unknown> | undefined {
  if (!existsSync(path)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

// Region segment of a CodeWhisperer ARN: arn:aws:codewhisperer:<region>:<acct>:...
function regionFromArn(arn: string | undefined): string | undefined {
  if (arn === undefined) return undefined
  const segments = arn.split(':')
  if (segments[0]?.toLowerCase() !== 'arn') return undefined
  const region = segments[3]?.trim()
  return region !== undefined && region.length > 0 ? region : undefined
}

// Recover the OIDC client registration (clientId + clientSecret) from the paired
// registration file. AWS SSO stores the token in <clientIdHash>.json's sibling:
// the token references clientIdHash, and a file named <clientIdHash>.json in the
// same dir holds { clientId, clientSecret, ... }. The clientId is the enterprise
// account identifier; the clientSecret is required to refresh IdC tokens (and is
// therefore stored ONLY in the encrypted credential, never in the plaintext
// profilePayload — see sanitizeProviderPayload's SENSITIVE set).
function resolveRegistration(
  authPath: string,
  clientIdHash: string | undefined,
): { clientId?: string; clientSecret?: string } {
  if (clientIdHash === undefined) return {}
  const cacheDir = dirname(authPath)
  const reg = readJsonObject(join(cacheDir, `${clientIdHash}.json`))
  if (!reg) return {}
  return {
    clientId: pickString(reg, [['clientId'], ['client_id']]),
    clientSecret: pickString(reg, [['clientSecret'], ['client_secret']]),
  }
}

// Scan ~/.aws/sso/cache for an Enterprise/IdC Kiro token when the well-known
// kiro-auth-token.json alias is absent. A token file has accessToken; a bare
// OIDC client registration only has clientId/clientSecret. We prefer files that
// also carry refreshToken/clientIdHash (the IdC token shape) and skip anything
// without an accessToken. Returns the most recently modified match.
function findKiroTokenInCache(cacheDir: string): string | undefined {
  if (!existsSync(cacheDir)) return undefined
  let entries: string[]
  try {
    entries = readdirSync(cacheDir).filter((name) => name.endsWith('.json'))
  } catch {
    return undefined
  }
  let best: { path: string; mtime: number } | undefined
  for (const name of entries) {
    const path = join(cacheDir, name)
    const obj = readJsonObject(path)
    if (!obj) continue
    const hasAccess =
      typeof obj.accessToken === 'string' || typeof obj.access_token === 'string'
    if (!hasAccess) continue
    let mtime = 0
    try {
      mtime = statSync(path).mtimeMs
    } catch {
      mtime = 0
    }
    if (best === undefined || mtime > best.mtime) best = { path, mtime }
  }
  return best?.path
}

// Usage telemetry is a plain (non-secret) state.vscdb item holding JSON. A read
// error is non-fatal for import (usage is metadata only).
function readUsage(dbPath: string): JsonValue | undefined {
  let raw: string | null
  try {
    raw = readVscdbItem(dbPath, LOCAL_USAGE_DB_KEY)
  } catch {
    return undefined
  }
  if (!raw) return undefined
  try {
    return JSON.parse(raw) as JsonValue
  } catch {
    return undefined
  }
}
