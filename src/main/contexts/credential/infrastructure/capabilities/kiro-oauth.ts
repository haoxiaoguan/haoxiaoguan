import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { JsonValue } from '../../../account/domain/platform-account-profile'
import type { PlatformId } from '../../../account/domain/platform-id'
import {
  DEFAULT_CANDIDATE_PORTS,
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
import { jwtPayload, parseExpiresAt, pickString } from '../scan-helpers'

// Kiro OAuth capability built on the platform LoopbackServer (event-driven, no
// busy-poll). start_oauth binds a candidate port, builds the app.kiro.dev/signin
// authorize URL (PKCE S256), and registers the /oauth/callback route.
// complete_oauth awaits the callback Promise (event-driven, no polling), then
// POSTs the code to the Kiro token endpoint and normalises the response.
//
// Token endpoint overridable via HAOXIAOGUAN_KIRO_TOKEN_ENDPOINT.

const KIRO_AUTH_PORTAL_URL = 'https://app.kiro.dev/signin'
const KIRO_TOKEN_ENDPOINT = 'https://prod.us-east-1.auth.desktop.kiro.dev/oauth/token'
const OAUTH_TIMEOUT_MS = 600_000

const execFileAsync = promisify(execFile)

interface PendingKiro {
  server: LoopbackServer
  callbackUrl: string
  stateToken: string
  codeVerifier: string
  callback: Promise<CallbackPayload>
  expiresAt: number
}

function token32(): string {
  return randomBytes(32).toString('base64url')
}

function codeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

function normalizeNonEmpty(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined
  const t = value.trim()
  return t.length > 0 ? t : undefined
}

function normalizeEmail(value: string | undefined): string | undefined {
  if (!value) return undefined
  const t = value.trim()
  return t.length > 0 && t.includes('@') ? t : undefined
}

async function isMwinitAvailable(): Promise<boolean> {
  const checker = process.platform === 'win32' ? 'where.exe' : 'which'
  try {
    await execFileAsync(checker, ['mwinit'])
    return true
  } catch {
    return false
  }
}

export class KiroOAuthCapability implements OAuthCapability {
  private readonly pending = new Map<string, PendingKiro>()
  private readonly tokenEndpoint: string

  constructor() {
    this.tokenEndpoint = process.env.HAOXIAOGUAN_KIRO_TOKEN_ENDPOINT ?? KIRO_TOKEN_ENDPOINT
  }

  provider(): PlatformId {
    return 'kiro'
  }

  async startOAuth(mode: OAuthMode): Promise<OAuthPending> {
    if (mode !== 'loopback_pkce') {
      throw CredentialError.unsupportedSource('kiro', 'oauth')
    }

    const server = new LoopbackServer()
    let boundPort: number
    try {
      boundPort = await server.tryBind(DEFAULT_CANDIDATE_PORTS)
    } catch {
      throw CredentialError.oauthPortInUse(DEFAULT_CANDIDATE_PORTS[0])
    }

    const pendingId = randomUUID()
    const callbackUrl = `http://localhost:${boundPort}`
    const stateToken = token32()
    const codeVerifier = token32()
    const challenge = codeChallenge(codeVerifier)
    const fromInternal = await isMwinitAvailable()
    const authorizeUrl = buildPortalAuthUrl(stateToken, challenge, callbackUrl, fromInternal)

    // Register the callback route; the Promise resolves on the first request.
    const callback = server.registerPath('/oauth/callback')

    this.pending.set(pendingId, {
      server,
      callbackUrl,
      stateToken,
      codeVerifier,
      callback,
      expiresAt: Date.now() + OAUTH_TIMEOUT_MS,
    })

    return {
      pendingId,
      authorizeUrl,
      redirectPath: '/oauth/callback',
      boundPort,
      state: stateToken,
      codeVerifier,
    }
  }

  async completeOAuth(pendingId: string, code: string): Promise<ImportedCredentialMaterial> {
    const state = this.pending.get(pendingId)
    if (!state) {
      throw CredentialError.internal(`pending oauth ${pendingId} not found`)
    }

    try {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(CredentialError.providerError('Kiro login timed out, please retry')),
          Math.max(0, state.expiresAt - Date.now()),
        ),
      )
      let payload: CallbackPayload
      try {
        payload = await Promise.race([state.callback, timeout])
      } catch (e) {
        // No callback yet but a code was passed directly (deep-link style).
        const direct = normalizeNonEmpty(code)
        if (!direct) throw e
        payload = { path: '/oauth/callback', query: { code: direct } }
      }

      // Validate state when present in the callback.
      const callbackState = payload.query.state
      if (callbackState !== undefined && callbackState !== state.stateToken) {
        throw CredentialError.providerError('OAuth state validation failed, please retry')
      }
      const authCode = normalizeNonEmpty(payload.query.code) ?? normalizeNonEmpty(code)
      if (!authCode) {
        throw CredentialError.invalidCredential('callback missing authorization code')
      }

      const loginOption = (payload.query.login_option ?? payload.query.loginOption ?? '').toLowerCase()
      const redirectUri = `${state.callbackUrl.replace(/\/$/, '')}/oauth/callback?login_option=${encodeURIComponent(loginOption)}`
      const tokenResponse = await this.exchangeCodeForToken(authCode, state.codeVerifier, redirectUri)
      return buildMaterialFromTokenResponse(tokenResponse)
    } finally {
      await state.server.close().catch(() => undefined)
      this.pending.delete(pendingId)
    }
  }

  private async exchangeCodeForToken(
    code: string,
    codeVerifier: string,
    redirectUri: string,
  ): Promise<Record<string, unknown>> {
    let resp: Response
    try {
      resp = await fetch(this.tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, code_verifier: codeVerifier, redirect_uri: redirectUri }),
      })
    } catch (e) {
      throw CredentialError.networkError(e instanceof Error ? e.message : String(e))
    }
    const body = await resp.text()
    if (!resp.ok) {
      throw CredentialError.providerError(
        `Kiro oauth/token returned an error, body_len=${body.length}`,
        String(resp.status),
      )
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(body)
    } catch (e) {
      throw CredentialError.invalidCredential(
        `parse Kiro oauth/token response failed: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
    return unwrapTokenResponse(parsed as Record<string, unknown>)
  }
}

function buildPortalAuthUrl(
  state: string,
  challenge: string,
  redirectUri: string,
  fromAmazonInternal: boolean,
): string {
  let url =
    `${KIRO_AUTH_PORTAL_URL}?state=${encodeURIComponent(state)}` +
    `&code_challenge=${encodeURIComponent(challenge)}&code_challenge_method=S256` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}&redirect_from=KiroIDE`
  if (fromAmazonInternal) url += '&from_amazon_internal=true'
  return url
}

function unwrapTokenResponse(response: Record<string, unknown>): Record<string, unknown> {
  const data = response.data
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return data as Record<string, unknown>
  }
  return response
}

function buildMaterialFromTokenResponse(token: Record<string, unknown>): ImportedCredentialMaterial {
  const accessToken = pickString(token, [
    ['accessToken'],
    ['access_token'],
    ['token'],
    ['idToken'],
    ['id_token'],
    ['accessTokenJwt'],
  ])
  if (!accessToken) {
    throw CredentialError.invalidCredential('Kiro oauth/token response missing access token')
  }
  const idToken = pickString(token, [['idToken'], ['id_token']])
  const idClaims = idToken ? jwtPayload(idToken) : undefined
  const accessClaims = jwtPayload(accessToken)
  const refreshToken = pickString(token, [['refreshToken'], ['refresh_token'], ['refreshTokenJwt']])

  const email =
    normalizeEmail(pickString(token, [['email'], ['userEmail']])) ??
    normalizeEmail(pickString(idClaims, [['email'], ['upn'], ['preferred_username']])) ??
    normalizeEmail(pickString(accessClaims, [['email'], ['upn'], ['preferred_username']])) ??
    normalizeEmail(pickString(token, [['login_hint'], ['loginHint']])) ??
    localKiroIdentifier(token, idClaims, accessClaims, refreshToken ?? accessToken)

  return {
    provider: 'kiro',
    email,
    accessToken,
    refreshToken,
    expiresAt: parseExpiresAt(token.expiresAt ?? token.expires_at ?? token.expiry ?? token.expiresIn ?? token.expires_in),
    source: 'oauth',
    rawMetadata: token as JsonValue,
  }
}

function localKiroIdentifier(
  token: Record<string, unknown>,
  idClaims: Record<string, unknown> | undefined,
  accessClaims: Record<string, unknown> | undefined,
  fallbackSecret: string,
): string {
  const raw =
    pickString(token, [
      ['userInfo', 'userId'],
      ['userId'],
      ['user_id'],
      ['sub'],
      ['accountId'],
      ['account', 'id'],
      ['login_hint'],
      ['loginHint'],
    ]) ??
    pickString(idClaims, [['sub'], ['user_id'], ['uid'], ['preferred_username']]) ??
    pickString(accessClaims, [['sub'], ['user_id'], ['uid'], ['preferred_username']])

  const sanitized = raw ? sanitizeIdentifierPart(raw) : ''
  if (sanitized.length > 0) return sanitized
  return `kiro-${shortHash(fallbackSecret)}`
}

function sanitizeIdentifierPart(raw: string): string {
  let out = ''
  for (const ch of raw.trim()) {
    if (/[a-zA-Z0-9]/.test(ch) || ch === '.' || ch === '_' || ch === '-') {
      out += ch.toLowerCase()
    } else if (/\s/.test(ch) || ch === ':' || ch === '/' || ch === '@') {
      out += '-'
    }
    if (out.length >= 48) break
  }
  return out.replace(/^[.\-_]+|[.\-_]+$/g, '')
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12)
}
