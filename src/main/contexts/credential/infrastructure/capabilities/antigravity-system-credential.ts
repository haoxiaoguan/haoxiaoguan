import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { JsonValue } from '../../../account/domain/platform-account-profile'
import type { ImportedCredentialMaterial } from '../../domain/capability-types'
import { ANTIGRAVITY_GOOGLE_CLIENT } from './antigravity-oauth'
import { GOOGLE_TOKEN_ENDPOINT, GOOGLE_USERINFO_ENDPOINT } from './google-oauth'
import { dispatcherFetch, normalizeNonEmpty, type OAuthFetch } from './oauth-http'

// Antigravity (legacy, non-IDE) desktop client >= 2.0 moved its login off
// state.vscdb onto the OS credential store (cockpit-tools
// antigravity_legacy_instance::AntigravityDesktopAuthMode::SystemCredential;
// pre-2.0 installs stay on state.vscdb, handled separately by
// antigravity-local-import.ts). On macOS this is a Keychain generic password
// — service "gemini", account "antigravity" — written as
// `go-keyring-base64:<base64 JSON>` where the JSON is
// `{ token: { access_token, token_type, refresh_token, expiry }, auth_method }`.
//
// That blob carries no email, so local-scan for this one platform must
// live-resolve identity via Google's userinfo endpoint — the only local-scan
// path in this codebase that needs the network. The stored access_token is
// typically a short-lived leftover from whenever the client last wrote it, so
// we refresh first and only fall back to using it as-is if that fails.

const execFileAsync = promisify(execFile)
const KEYCHAIN_SERVICE = 'gemini'
const KEYCHAIN_ACCOUNT = 'antigravity'
const SECRET_PREFIX = 'go-keyring-base64:'

/** Read the raw Keychain secret. macOS only; undefined if absent/not signed in. */
export async function readAntigravityKeychainSecret(): Promise<string | undefined> {
  if (process.platform !== 'darwin') return undefined
  try {
    const { stdout } = await execFileAsync('security', [
      'find-generic-password',
      '-s',
      KEYCHAIN_SERVICE,
      '-a',
      KEYCHAIN_ACCOUNT,
      '-w',
    ])
    return normalizeNonEmpty(stdout)
  } catch {
    return undefined
  }
}

interface StoredTokenJson {
  access_token?: string
  token_type?: string
  refresh_token?: string
  expiry?: string
}

interface StoredPayloadJson {
  token?: StoredTokenJson
  auth_method?: string
}

export interface AntigravitySystemCredential {
  accessToken: string
  refreshToken?: string | undefined
  tokenType?: string | undefined
  expiryIso?: string | undefined
  authMethod?: string | undefined
}

/** Decode the `go-keyring-base64:` secret into its token fields. */
export function parseAntigravitySystemCredentialSecret(
  secret: string,
): AntigravitySystemCredential | undefined {
  const trimmed = secret.trim()
  if (!trimmed.startsWith(SECRET_PREFIX)) return undefined
  let payload: StoredPayloadJson
  try {
    const json = Buffer.from(trimmed.slice(SECRET_PREFIX.length), 'base64').toString('utf8')
    payload = JSON.parse(json) as StoredPayloadJson
  } catch {
    return undefined
  }
  const accessToken = normalizeNonEmpty(payload.token?.access_token)
  if (!accessToken) return undefined
  return {
    accessToken,
    refreshToken: normalizeNonEmpty(payload.token?.refresh_token),
    tokenType: normalizeNonEmpty(payload.token?.token_type),
    expiryIso: normalizeNonEmpty(payload.token?.expiry),
    authMethod: normalizeNonEmpty(payload.auth_method),
  }
}

interface GoogleRefreshResponse {
  access_token?: string
  expires_in?: number
}

interface GoogleUserInfo {
  id?: string
  email?: string
  name?: string
}

async function refreshAccessToken(
  refreshToken: string,
  transport: OAuthFetch,
): Promise<{ accessToken: string; expiresAt: Date | undefined } | undefined> {
  const body = new URLSearchParams({
    client_id: ANTIGRAVITY_GOOGLE_CLIENT.clientId,
    client_secret: ANTIGRAVITY_GOOGLE_CLIENT.clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  })
  try {
    const resp = await transport(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
    if (!resp.ok) return undefined
    const parsed = (await resp.json()) as GoogleRefreshResponse
    const accessToken = normalizeNonEmpty(parsed.access_token)
    if (!accessToken) return undefined
    const expiresAt =
      typeof parsed.expires_in === 'number' && parsed.expires_in > 0
        ? new Date(Date.now() + parsed.expires_in * 1000)
        : undefined
    return { accessToken, expiresAt }
  } catch {
    return undefined
  }
}

async function fetchUserInfo(
  accessToken: string,
  transport: OAuthFetch,
): Promise<GoogleUserInfo | undefined> {
  try {
    const resp = await transport(GOOGLE_USERINFO_ENDPOINT, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    })
    if (!resp.ok) return undefined
    return (await resp.json()) as GoogleUserInfo
  } catch {
    return undefined
  }
}

export interface ResolveSystemCredentialOpts {
  transport?: OAuthFetch
}

/**
 * Live-resolve a Keychain-sourced credential into ImportedCredentialMaterial.
 * Returns undefined on any failure (expired + unrefreshable, network error,
 * no email in userinfo) so the caller can fall back to the legacy
 * state.vscdb parse instead of surfacing a half-built account.
 */
export async function resolveAntigravitySystemCredential(
  credential: AntigravitySystemCredential,
  opts: ResolveSystemCredentialOpts = {},
): Promise<ImportedCredentialMaterial | undefined> {
  const transport = opts.transport ?? dispatcherFetch

  let accessToken = credential.accessToken
  let expiresAt = normalizeNonEmpty(credential.expiryIso)
    ? new Date(credential.expiryIso as string)
    : undefined

  if (credential.refreshToken) {
    const refreshed = await refreshAccessToken(credential.refreshToken, transport)
    if (refreshed) {
      accessToken = refreshed.accessToken
      expiresAt = refreshed.expiresAt ?? expiresAt
    }
  }

  const userInfo = await fetchUserInfo(accessToken, transport)
  const email = normalizeNonEmpty(userInfo?.email)
  if (!email) return undefined

  const oauthRaw: Record<string, JsonValue> = {
    access_token: accessToken,
    token_type: credential.tokenType ?? 'Bearer',
  }
  if (credential.refreshToken) oauthRaw.refresh_token = credential.refreshToken
  if (expiresAt) oauthRaw.expiry = Math.floor(expiresAt.getTime() / 1000)

  const userRaw: Record<string, JsonValue> = { email }
  if (userInfo?.name) userRaw.name = userInfo.name
  if (userInfo?.id) userRaw.id = userInfo.id

  const rawMetadata: JsonValue = {
    email,
    auth_id: userInfo?.id ?? null,
    selected_auth_type: 'google',
    oauth_client_key: 'antigravity_enterprise',
    antigravity_oauth_raw: oauthRaw,
    antigravity_user_raw: userRaw,
  }

  return {
    provider: 'antigravity',
    email,
    accessToken,
    refreshToken: credential.refreshToken,
    expiresAt,
    source: 'local_scan',
    rawMetadata,
  }
}
