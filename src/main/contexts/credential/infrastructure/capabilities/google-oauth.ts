import { randomUUID } from 'node:crypto'
import type { JsonValue } from '../../../account/domain/platform-account-profile'
import type { PlatformId } from '../../../account/domain/platform-id'
import {
  EPHEMERAL_PORT,
  LoopbackServer,
  type CallbackPayload,
} from '../../../../platform/oauth/loopback-server'
import type { OAuthCapability } from '../../domain/capabilities'
import type {
  ImportedCredentialMaterial,
  OAuthMode,
  OAuthPending,
} from '../../domain/capability-types'
import { CredentialError } from '../../domain/credential-error'
import { jwtPayload, pickString } from '../scan-helpers'
import { dispatcherFetch, normalizeNonEmpty, token32, type OAuthFetch } from './oauth-http'

// Shared Google OAuth (authorization-code + loopback) base for the two Google
// clients cockpit-tools uses: Antigravity and Gemini CLI. Both are standard
// OAuth2 with a hardcoded client_secret (public-desktop clients, no PKCE) and a
// dynamic 127.0.0.1 redirect. Subclasses supply the client config + the
// provider-specific rawMetadata builder so the derived profile matches the
// existing local-scan/token-json shape.

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
// Exported for antigravity-system-credential.ts, which refreshes/resolves a
// Keychain-sourced token outside the loopback-authorize flow this class runs.
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
export const GOOGLE_USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v2/userinfo'
const OAUTH_TIMEOUT_MS = 300_000

export interface GoogleTokenResponse {
  access_token?: string
  refresh_token?: string
  id_token?: string
  token_type?: string
  scope?: string
  expires_in?: number
}

export interface GoogleUserInfo {
  id?: string
  email?: string
  name?: string
}

export interface GoogleOAuthConfig {
  provider: PlatformId
  clientId: string
  clientSecret: string
  scopes: string[]
  callbackPath: string
  /** extra authorize params (e.g. prompt=consent for Antigravity). */
  extraAuthParams?: Record<string, string>
}

/** Optional overrides for the Google-family capabilities (tests inject transport/endpoints). */
export interface OAuthFetchOpts {
  transport?: OAuthFetch
  authEndpoint?: string
  tokenEndpoint?: string
  userinfoEndpoint?: string
}

interface PendingGoogle {
  server: LoopbackServer
  redirectUri: string
  stateToken: string
  callback: Promise<CallbackPayload>
  expiresAt: number
}

export abstract class GoogleLoopbackOAuthCapability implements OAuthCapability {
  private readonly pending = new Map<string, PendingGoogle>()
  private readonly authEndpoint: string
  private readonly tokenEndpoint: string
  private readonly userinfoEndpoint: string
  private readonly transport: OAuthFetch

  protected constructor(
    private readonly config: GoogleOAuthConfig,
    opts?: OAuthFetchOpts,
  ) {
    this.transport = opts?.transport ?? dispatcherFetch
    this.authEndpoint = opts?.authEndpoint ?? GOOGLE_AUTH_ENDPOINT
    this.tokenEndpoint = opts?.tokenEndpoint ?? GOOGLE_TOKEN_ENDPOINT
    this.userinfoEndpoint = opts?.userinfoEndpoint ?? GOOGLE_USERINFO_ENDPOINT
  }

  provider(): PlatformId {
    return this.config.provider
  }

  /** Build the provider-specific normalised material from the token + userinfo. */
  protected abstract buildMaterial(
    token: GoogleTokenResponse,
    userInfo: GoogleUserInfo | undefined,
  ): ImportedCredentialMaterial

  async startOAuth(mode: OAuthMode): Promise<OAuthPending> {
    if (mode !== 'loopback_pkce') {
      throw CredentialError.unsupportedSource(this.config.provider, 'oauth')
    }
    const server = new LoopbackServer()
    let boundPort: number
    try {
      boundPort = await server.tryBind([EPHEMERAL_PORT])
    } catch {
      throw CredentialError.oauthPortInUse(0)
    }
    const pendingId = randomUUID()
    const redirectUri = `http://localhost:${boundPort}${this.config.callbackPath}`
    const stateToken = token32()
    const authorizeUrl = this.buildAuthorizeUrl(redirectUri, stateToken)
    const callback = server.registerPath(this.config.callbackPath)

    this.pending.set(pendingId, {
      server,
      redirectUri,
      stateToken,
      callback,
      expiresAt: Date.now() + OAUTH_TIMEOUT_MS,
    })

    return {
      pendingId,
      authorizeUrl,
      redirectPath: this.config.callbackPath,
      boundPort,
      state: stateToken,
      codeVerifier: '',
    }
  }

  async completeOAuth(pendingId: string, code: string): Promise<ImportedCredentialMaterial> {
    const state = this.pending.get(pendingId)
    if (!state) {
      throw CredentialError.internal(`pending oauth ${pendingId} not found`)
    }
    let timeoutHandle: NodeJS.Timeout | undefined
    try {
      const timeout = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(CredentialError.providerError(`${this.config.provider} login timed out, please retry`)),
          Math.max(0, state.expiresAt - Date.now()),
        )
      })
      let payload: CallbackPayload
      try {
        payload = await Promise.race([state.callback, timeout])
      } catch (e) {
        const direct = normalizeNonEmpty(code)
        if (!direct) throw e
        payload = { path: this.config.callbackPath, query: { code: direct } }
      }

      if (payload.query.error !== undefined) {
        throw CredentialError.providerError(
          `Google OAuth failed: ${payload.query.error_description ?? payload.query.error}`,
        )
      }
      const callbackState = payload.query.state
      if (callbackState !== undefined && callbackState !== state.stateToken) {
        throw CredentialError.providerError('OAuth state validation failed, please retry')
      }
      const authCode = normalizeNonEmpty(payload.query.code) ?? normalizeNonEmpty(code)
      if (!authCode) {
        throw CredentialError.invalidCredential('callback missing authorization code')
      }

      const token = await this.exchangeCode(authCode, state.redirectUri)
      const userInfo = token.access_token ? await this.fetchUserInfo(token.access_token) : undefined
      return this.buildMaterial(token, userInfo)
    } finally {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle)
      await state.server.close().catch(() => undefined)
      this.pending.delete(pendingId)
    }
  }

  private buildAuthorizeUrl(redirectUri: string, state: string): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: this.config.scopes.join(' '),
      access_type: 'offline',
      state,
      ...(this.config.extraAuthParams ?? {}),
    })
    return `${this.authEndpoint}?${params.toString()}`
  }

  private async exchangeCode(code: string, redirectUri: string): Promise<GoogleTokenResponse> {
    const body = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    })
    let resp: Response
    try {
      resp = await this.transport(this.tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      })
    } catch (e) {
      throw CredentialError.networkError(e instanceof Error ? e.message : String(e))
    }
    const text = await resp.text()
    if (!resp.ok) {
      throw CredentialError.providerError(
        `Google oauth/token returned an error, body_len=${text.length}`,
        String(resp.status),
      )
    }
    let parsed: GoogleTokenResponse
    try {
      parsed = JSON.parse(text) as GoogleTokenResponse
    } catch (e) {
      throw CredentialError.invalidCredential(
        `parse Google oauth/token response failed: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
    if (!normalizeNonEmpty(parsed.access_token)) {
      throw CredentialError.invalidCredential('Google oauth/token response missing access_token')
    }
    return parsed
  }

  private async fetchUserInfo(accessToken: string): Promise<GoogleUserInfo | undefined> {
    try {
      const resp = await this.transport(this.userinfoEndpoint, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      })
      if (!resp.ok) return undefined
      return (await resp.json()) as GoogleUserInfo
    } catch {
      return undefined
    }
  }
}

/** email/sub/name resolution shared by both Google clients (userinfo → JWT claims). */
export function resolveGoogleIdentity(
  token: GoogleTokenResponse,
  userInfo: GoogleUserInfo | undefined,
): { email: string; authId: string | undefined; name: string | undefined } {
  const idClaims = token.id_token ? jwtPayload(token.id_token) : undefined
  const email =
    normalizeNonEmpty(userInfo?.email) ??
    pickString(idClaims, [['email']]) ??
    'unknown@gmail.com'
  const authId =
    normalizeNonEmpty(userInfo?.id) ?? pickString(idClaims, [['sub']])
  const name = normalizeNonEmpty(userInfo?.name) ?? pickString(idClaims, [['name']])
  return { email, authId, name }
}

export function googleExpiresAt(token: GoogleTokenResponse): Date | undefined {
  return typeof token.expires_in === 'number' && token.expires_in > 0
    ? new Date(Date.now() + token.expires_in * 1000)
    : undefined
}

/** Common auth_raw block persisted for both Google clients. */
export function googleAuthRaw(
  token: GoogleTokenResponse,
  email: string,
  authId: string | undefined,
  expiresAt: Date | undefined,
): Record<string, JsonValue> {
  const raw: Record<string, JsonValue> = { access_token: token.access_token ?? '', email }
  if (token.refresh_token) raw.refresh_token = token.refresh_token
  if (token.id_token) raw.id_token = token.id_token
  if (token.token_type) raw.token_type = token.token_type
  if (token.scope) raw.scope = token.scope
  if (expiresAt) raw.expiry_date = expiresAt.getTime()
  if (authId) raw.sub = authId
  return raw
}
