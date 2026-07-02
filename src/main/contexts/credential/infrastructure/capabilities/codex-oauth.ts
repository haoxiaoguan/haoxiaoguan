import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { PlatformId } from '../../../account/domain/platform-id'
import { LoopbackServer, type CallbackPayload } from '../../../../platform/oauth/loopback-server'
import type { OAuthCapability } from '../../domain/capabilities'
import type {
  ImportedCredentialMaterial,
  OAuthMode,
  OAuthPending,
} from '../../domain/capability-types'
import { CredentialError } from '../../domain/credential-error'
import { materialFromOauthTokens } from './codex-local-import'
import { dispatcherFetch, type OAuthFetch } from './oauth-http'

// Codex (OpenAI) OAuth capability — loopback PKCE, mirroring the reference flow
// in cockpit-tools crates/cockpit-core/src/modules/codex_oauth.rs:
//   1. bind 127.0.0.1:1455 (FIXED — the redirect_uri registered for this
//      client_id is http://localhost:1455/auth/callback, no candidate list),
//   2. open https://auth.openai.com/oauth/authorize with PKCE S256 + state,
//   3. the browser redirects to /auth/callback?code=...&state=...,
//   4. exchange the code at /oauth/token (form-urlencoded, public client, no
//      secret), yielding { id_token, access_token, refresh_token }.
// The material is normalised through codex-local-import's
// materialFromOauthTokens so rawMetadata matches the auth.json local-scan shape
// exactly (auth_mode=chatgpt_oauth) — refresh (codex-credential-refresher),
// injection (codex-auth-file) and profile derivation all keep working.
//
// Token refresh afterwards is NOT this capability's job — the existing
// CodexCredentialRefresher / quota fetcher already refresh with the same
// client_id (note: refresh uses a JSON body, code exchange uses form).

const CODEX_AUTH_ENDPOINT = 'https://auth.openai.com/oauth/authorize'
const CODEX_TOKEN_ENDPOINT = 'https://auth.openai.com/oauth/token'
const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const CODEX_SCOPES = 'openid profile email offline_access api.connectors.read api.connectors.invoke'
const CODEX_ORIGINATOR = 'codex_vscode'
/** Fixed loopback port registered upstream for this client_id. */
const CODEX_CALLBACK_PORT = 1455
const CODEX_CALLBACK_PATH = '/auth/callback'
const OAUTH_TIMEOUT_MS = 300_000

export type CodexOAuthFetch = OAuthFetch

interface PendingCodex {
  server: LoopbackServer
  redirectUri: string
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

export class CodexOAuthCapability implements OAuthCapability {
  private readonly pending = new Map<string, PendingCodex>()
  private readonly tokenEndpoint: string
  private readonly authEndpoint: string
  private readonly callbackPorts: number[]
  private readonly transport: CodexOAuthFetch

  constructor(opts?: { transport?: CodexOAuthFetch; callbackPorts?: number[] }) {
    this.tokenEndpoint = process.env.HAOXIAOGUAN_CODEX_TOKEN_ENDPOINT ?? CODEX_TOKEN_ENDPOINT
    this.authEndpoint = process.env.HAOXIAOGUAN_CODEX_AUTH_ENDPOINT ?? CODEX_AUTH_ENDPOINT
    this.callbackPorts = opts?.callbackPorts ?? [CODEX_CALLBACK_PORT]
    this.transport = opts?.transport ?? dispatcherFetch
  }

  provider(): PlatformId {
    return 'codex'
  }

  async startOAuth(mode: OAuthMode): Promise<OAuthPending> {
    if (mode !== 'loopback_pkce') {
      throw CredentialError.unsupportedSource('codex', 'oauth')
    }

    const server = new LoopbackServer()
    let boundPort: number
    try {
      boundPort = await server.tryBind(this.callbackPorts)
    } catch {
      throw CredentialError.oauthPortInUse(this.callbackPorts[0])
    }

    const pendingId = randomUUID()
    const redirectUri = `http://localhost:${boundPort}${CODEX_CALLBACK_PATH}`
    const stateToken = token32()
    const codeVerifier = token32()
    const authorizeUrl = this.buildAuthorizeUrl(redirectUri, codeChallenge(codeVerifier), stateToken)

    const callback = server.registerPath(CODEX_CALLBACK_PATH)

    this.pending.set(pendingId, {
      server,
      redirectUri,
      stateToken,
      codeVerifier,
      callback,
      expiresAt: Date.now() + OAUTH_TIMEOUT_MS,
    })

    return {
      pendingId,
      authorizeUrl,
      redirectPath: CODEX_CALLBACK_PATH,
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

    let timeoutHandle: NodeJS.Timeout | undefined
    try {
      const timeout = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(CredentialError.providerError('Codex login timed out, please retry')),
          Math.max(0, state.expiresAt - Date.now()),
        )
      })
      let payload: CallbackPayload
      try {
        payload = await Promise.race([state.callback, timeout])
      } catch (e) {
        // No callback yet but a code was passed directly (manual paste style).
        const direct = normalizeNonEmpty(code)
        if (!direct) throw e
        payload = { path: CODEX_CALLBACK_PATH, query: { code: direct } }
      }

      if (payload.query.error !== undefined) {
        throw CredentialError.providerError(
          `Codex authorization failed: ${payload.query.error_description ?? payload.query.error}`,
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

      const tokenResponse = await this.exchangeCodeForToken(
        authCode,
        state.codeVerifier,
        state.redirectUri,
      )
      return buildMaterialFromTokenResponse(tokenResponse)
    } finally {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle)
      await state.server.close().catch(() => undefined)
      this.pending.delete(pendingId)
    }
  }

  private buildAuthorizeUrl(redirectUri: string, challenge: string, state: string): string {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: CODEX_CLIENT_ID,
      redirect_uri: redirectUri,
      scope: CODEX_SCOPES,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      id_token_add_organizations: 'true',
      codex_cli_simplified_flow: 'true',
      state,
      originator: CODEX_ORIGINATOR,
    })
    return `${this.authEndpoint}?${params.toString()}`
  }

  private async exchangeCodeForToken(
    code: string,
    codeVerifier: string,
    redirectUri: string,
  ): Promise<Record<string, unknown>> {
    // Code exchange is form-urlencoded (the refresh flow uses JSON instead).
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: CODEX_CLIENT_ID,
      code_verifier: codeVerifier,
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
        `Codex oauth/token returned an error, body_len=${text.length}`,
        String(resp.status),
      )
    }
    try {
      const parsed = JSON.parse(text) as unknown
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('token response is not a JSON object')
      }
      return parsed as Record<string, unknown>
    } catch (e) {
      throw CredentialError.invalidCredential(
        `parse Codex oauth/token response failed: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
  }
}

function buildMaterialFromTokenResponse(
  token: Record<string, unknown>,
): ImportedCredentialMaterial {
  const accessToken = normalizeNonEmpty(
    typeof token.access_token === 'string' ? token.access_token : undefined,
  )
  if (!accessToken) {
    throw CredentialError.invalidCredential('Codex oauth/token response missing access_token')
  }

  // Normalise to the auth.json `tokens` shape and reuse the local-import
  // normaliser so rawMetadata (auth_mode, plan_type, account_id, tokens…) is
  // identical to a local scan of the same login.
  const tokens: Record<string, unknown> = { access_token: accessToken }
  if (typeof token.id_token === 'string' && token.id_token.length > 0) {
    tokens.id_token = token.id_token
  }
  if (typeof token.refresh_token === 'string' && token.refresh_token.length > 0) {
    tokens.refresh_token = token.refresh_token
  }
  if (typeof token.expires_in === 'number' && token.expires_in > 0) {
    tokens.expires_at = Math.floor(Date.now() / 1000) + Math.floor(token.expires_in)
  }

  const materials = materialFromOauthTokens(tokens, {}, 'oauth')
  const material = materials[0]
  if (material === undefined) {
    throw CredentialError.invalidCredential('Codex oauth/token response yielded no material')
  }
  return material
}
