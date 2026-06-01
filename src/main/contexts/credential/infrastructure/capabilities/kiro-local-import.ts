import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
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

const LOCAL_USAGE_DB_KEY = 'kiro.kiroAgent'

export class KiroLocalImportCapability implements LocalImportCapability {
  constructor(
    private readonly authTokenPathOverride?: string,
    private readonly profilePathOverride?: string,
    private readonly stateDbPathOverride?: string,
  ) {}

  provider(): PlatformId {
    return 'kiro'
  }

  private authTokenPath(): string | undefined {
    if (this.authTokenPathOverride) return this.authTokenPathOverride
    const home = homeDir()
    return home ? join(home, '.aws', 'sso', 'cache', 'kiro-auth-token.json') : undefined
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
      (idToken ? jwtClaimString(idToken, 'email') : undefined) ??
      (idToken ? jwtClaimString(idToken, 'sub') : undefined) ??
      jwtClaimString(accessToken, 'sub') ??
      'kiro-user'

    const expiresAt = parseExpiresAt(
      authToken.expiresAt ?? authToken.expires_at ?? authToken.expiration,
    )

    const loginProvider =
      pickString(profile, [['loginProvider'], ['provider'], ['authProvider']]) ??
      pickString(authToken, [['login_option'], ['loginProvider']])
    const userId =
      pickString(profile, [['userId'], ['user_id'], ['id'], ['sub']]) ??
      (idToken ? jwtClaimString(idToken, 'sub') : undefined)

    const rawMetadata: JsonValue = {
      email,
      user_id: userId ?? null,
      login_provider: loginProvider ?? null,
      accessToken,
      refreshToken: refreshToken ?? null,
      idToken: idToken ?? null,
      kiro_auth_token_raw: authToken as JsonValue,
      kiro_profile_raw: (profile ?? null) as JsonValue,
      kiro_usage_raw: (usage ?? null) as JsonValue,
    }

    return [
      {
        provider: 'kiro',
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
