import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { JsonValue } from '../../../account/domain/platform-account-profile'
import type { PlatformId } from '../../../account/domain/platform-id'
import type { LocalImportCapability } from '../../domain/capabilities'
import type { ImportedCredentialMaterial } from '../../domain/capability-types'
import { CredentialError } from '../../domain/credential-error'
import { homeDir, jwtClaimString, jwtPayload, parseExpiresAt, pickString } from '../scan-helpers'

// Codex local-scan capability. Reads ~/.codex/auth.json (or
// $CODEX_HOME/auth.json). Handles both API-key and ChatGPT-OAuth auth modes,
// extracting claims from the id/access JWTs. The macOS Keychain fallback (Codex
// Auth, account = "cli|" + sha256(canonical home)[..16]) is NOT implemented here
// (see manifest TODO) — auth.json covers the common path.

const API_KEY_AUTH_MODE = 'apikey'

export class CodexLocalImportCapability implements LocalImportCapability {
  constructor(private readonly homePathOverride?: string) {}

  provider(): PlatformId {
    return 'codex'
  }

  private homePath(): string | undefined {
    if (this.homePathOverride) return this.homePathOverride
    if (process.env.CODEX_HOME) return process.env.CODEX_HOME
    const home = homeDir()
    return home ? join(home, '.codex') : undefined
  }

  async scanLocal(): Promise<ImportedCredentialMaterial[]> {
    const home = this.homePath()
    if (!home) return []
    const authPath = join(home, 'auth.json')
    if (!existsSync(authPath)) return []

    let authFile: Record<string, unknown>
    try {
      authFile = JSON.parse(readFileSync(authPath, 'utf8')) as Record<string, unknown>
    } catch (e) {
      throw CredentialError.invalidCredential(
        `parse Codex auth.json failed: ${e instanceof Error ? e.message : String(e)}`,
      )
    }

    const authMode = authFile.auth_mode
    if (typeof authMode === 'string' && isApiKeyMode(authMode)) {
      return materialFromApiKey(authFile)
    }

    const tokens = authFile.tokens
    if (tokens && typeof tokens === 'object') {
      return materialFromOauthTokens(tokens as Record<string, unknown>, authFile)
    }

    const apiKey = pickString(authFile, [['OPENAI_API_KEY']])
    if (apiKey) return [apiKeyMaterial(apiKey, authFile)]

    return []
  }
}

function isApiKeyMode(value: string): boolean {
  const m = value.trim().toLowerCase()
  return m === API_KEY_AUTH_MODE || m === 'api_key'
}

function materialFromApiKey(authFile: Record<string, unknown>): ImportedCredentialMaterial[] {
  const apiKey = pickString(authFile, [['OPENAI_API_KEY'], ['api_key']])
  if (!apiKey) return []
  return [apiKeyMaterial(apiKey, authFile)]
}

function apiKeyMaterial(apiKey: string, authFile: Record<string, unknown>): ImportedCredentialMaterial {
  const baseUrl = pickString(authFile, [['base_url'], ['api_base_url'], ['apiBaseUrl']])
  const email = baseUrl
    ? `api-key@${baseUrl.replace(/^https:\/\//, '')}`
    : 'openai-api-key'
  const rawMetadata: JsonValue = {
    email,
    auth_mode: 'api_key',
    plan_type: 'API Key',
    access_token: apiKey,
    api_key: apiKey,
    base_url: baseUrl ?? null,
    tokens: authFile as JsonValue,
  }
  return {
    provider: 'codex',
    email,
    accessToken: apiKey,
    refreshToken: undefined,
    expiresAt: undefined,
    source: 'local_scan',
    rawMetadata,
  }
}

function materialFromOauthTokens(
  tokens: Record<string, unknown>,
  authFile: Record<string, unknown>,
): ImportedCredentialMaterial[] {
  const accessToken = pickString(tokens, [['access_token'], ['accessToken']])
  if (!accessToken) {
    throw CredentialError.invalidCredential('Codex auth.json tokens missing access_token')
  }
  const refreshToken = pickString(tokens, [['refresh_token'], ['refreshToken']])
  const idToken = pickString(tokens, [['id_token'], ['idToken']])
  const idClaims = idToken ? jwtPayload(idToken) : undefined
  const accessClaims = jwtPayload(accessToken)

  const email =
    pickString(idClaims, [['email'], ['https://api.openai.com/profile', 'email']]) ??
    pickString(accessClaims, [['email'], ['https://api.openai.com/profile', 'email']]) ??
    (idToken ? jwtClaimString(idToken, 'sub') : undefined) ??
    jwtClaimString(accessToken, 'sub') ??
    'codex-user'

  const userId =
    pickString(idClaims, [
      ['https://api.openai.com/auth', 'chatgpt_user_id'],
      ['https://api.openai.com/auth', 'user_id'],
      ['sub'],
    ]) ?? pickString(accessClaims, [['sub']])

  const accountId =
    pickString(accessClaims, [
      ['https://api.openai.com/auth', 'chatgpt_account_id'],
      ['https://api.openai.com/auth', 'account_id'],
      ['chatgpt_account_id'],
      ['account_id'],
    ]) ?? pickString(tokens, [['account_id'], ['accountId']])

  const planType = pickString(idClaims, [['https://api.openai.com/auth', 'chatgpt_plan_type']])

  const expiresAt = parseExpiresAt(
    tokens.expires_at ?? tokens.expiresAt ?? authFile.expires_at,
  )

  const rawMetadata: JsonValue = {
    email,
    user_id: userId ?? null,
    account_id: accountId ?? null,
    auth_mode: 'chatgpt_oauth',
    plan_type: planType ?? 'ChatGPT',
    access_token: accessToken,
    refresh_token: refreshToken ?? null,
    id_token: idToken ?? null,
    expires_at: expiresAt ? Math.floor(expiresAt.getTime() / 1000) : null,
    tokens: tokens as JsonValue,
  }

  return [
    {
      provider: 'codex',
      email,
      accessToken,
      refreshToken,
      expiresAt,
      source: 'local_scan',
      rawMetadata,
    },
  ]
}
