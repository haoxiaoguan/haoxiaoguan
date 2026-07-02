import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { JsonValue } from '../../../account/domain/platform-account-profile'
import type { PlatformId } from '../../../account/domain/platform-id'
import type { LocalImportCapability } from '../../domain/capabilities'
import type { ImportedCredentialMaterial } from '../../domain/capability-types'
import { homeDir, jwtClaimString, parseExpiresAt, pickString } from '../scan-helpers'

// Gemini CLI local-scan capability. Mirrors cockpit-tools gemini_account::
// import_from_local: read ~/.gemini/oauth_creds.json (access/refresh/id token),
// google_accounts.json (active email), settings.json (selectedType); on macOS
// fall back to the Keychain (service=gemini-cli-oauth, account=main-account) when
// the file is absent. rawMetadata matches the gemini profile derivation
// (gemini_auth_raw / selected_auth_type / auth_id) and the injection shape.

const execFileAsync = promisify(execFile)
const KEYCHAIN_SERVICE = 'gemini-cli-oauth'
const KEYCHAIN_ACCOUNT = 'main-account'

interface OauthCreds {
  access_token?: string | undefined
  refresh_token?: string | undefined
  id_token?: string | undefined
  token_type?: string | undefined
  scope?: string | undefined
  expiry_date?: number | undefined
}

function readJsonObject(path: string): Record<string, unknown> | undefined {
  if (!existsSync(path)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

export class GeminiLocalImportCapability implements LocalImportCapability {
  constructor(private readonly homeOverride?: string) {}

  provider(): PlatformId {
    return 'gemini_cli'
  }

  private geminiHome(): string | undefined {
    if (this.homeOverride) return this.homeOverride
    const home = homeDir()
    return home ? join(home, '.gemini') : undefined
  }

  async scanLocal(): Promise<ImportedCredentialMaterial[]> {
    const home = this.geminiHome()
    if (!home) return []

    const creds = (readJsonObject(join(home, 'oauth_creds.json')) as OauthCreds | undefined) ??
      (await this.readKeychainCreds())
    const accessToken = pickString(creds, [['access_token'], ['accessToken']])
    if (!accessToken) return []

    const refreshToken = pickString(creds, [['refresh_token'], ['refreshToken']])
    const idToken = pickString(creds, [['id_token'], ['idToken']])
    const tokenType = pickString(creds, [['token_type'], ['tokenType']]) ?? 'Bearer'
    const scope = pickString(creds, [['scope']])
    const expiryRaw = creds?.expiry_date ?? (creds as Record<string, unknown> | undefined)?.expiresAt
    const expiresAt = parseExpiresAt(expiryRaw as JsonValue)

    const accounts = readJsonObject(join(home, 'google_accounts.json'))
    const activeEmail = pickString(accounts, [['active']])
    const settings = readJsonObject(join(home, 'settings.json'))
    const selectedType =
      pickString(settings, [['security', 'auth', 'selectedType']]) ?? 'oauth-personal'

    const email =
      activeEmail ??
      (idToken ? jwtClaimString(idToken, 'email') : undefined) ??
      (idToken ? jwtClaimString(idToken, 'sub') : undefined) ??
      'gemini-user'
    const sub = idToken ? jwtClaimString(idToken, 'sub') : undefined

    const authRaw: Record<string, JsonValue> = { access_token: accessToken, email }
    if (refreshToken) authRaw.refresh_token = refreshToken
    if (idToken) authRaw.id_token = idToken
    if (tokenType) authRaw.token_type = tokenType
    if (scope) authRaw.scope = scope
    if (expiresAt) authRaw.expiry_date = expiresAt.getTime()
    if (sub) authRaw.sub = sub

    const rawMetadata: JsonValue = {
      email,
      auth_id: sub ?? null,
      selected_auth_type: selectedType,
      gemini_auth_raw: authRaw,
    }

    return [
      {
        provider: 'gemini_cli',
        email,
        accessToken,
        refreshToken,
        expiresAt,
        source: 'local_scan',
        rawMetadata,
      },
    ]
  }

  // macOS keychain 兜底：security find-generic-password -w -s gemini-cli-oauth -a main-account
  // → JSON { serverName, token: { accessToken, refreshToken, scope, expiresAt }, updatedAt }。
  private async readKeychainCreds(): Promise<OauthCreds | undefined> {
    if (process.platform !== 'darwin') return undefined
    try {
      const { stdout } = await execFileAsync('security', [
        'find-generic-password',
        '-w',
        '-s',
        KEYCHAIN_SERVICE,
        '-a',
        KEYCHAIN_ACCOUNT,
      ])
      const parsed = JSON.parse(stdout.trim()) as { token?: Record<string, unknown> }
      const token = parsed.token
      if (token === undefined) return undefined
      return {
        access_token: pickString(token, [['accessToken'], ['access_token']]),
        refresh_token: pickString(token, [['refreshToken'], ['refresh_token']]),
        token_type: pickString(token, [['tokenType'], ['token_type']]),
        scope: pickString(token, [['scope']]),
        expiry_date:
          typeof token.expiresAt === 'number'
            ? token.expiresAt
            : typeof token.expires_at === 'number'
              ? token.expires_at
              : undefined,
      }
    } catch {
      return undefined
    }
  }
}
