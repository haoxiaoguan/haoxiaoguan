import { randomUUID } from 'node:crypto'
import { platform as osPlatform } from 'node:os'
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
import { dispatcherFetch, normalizeNonEmpty, token32, type OAuthFetch } from './oauth-http'

// Windsurf OAuth (Firebase implicit + Codeium RegisterUser). Ported from
// cockpit-tools modules/windsurf_oauth.rs:
//   1. bind an ephemeral loopback port, open windsurf.com/windsurf/signin with
//      response_type=token (implicit — the callback carries a Firebase JWT),
//   2. RegisterUser(firebase_id_token) → { apiKey (sk-ws-), apiServerUrl, name },
//   3. best-effort GetOneTimeAuthToken / GetCurrentUser / GetPlanStatus /
//      GetUserStatus for email + plan/quota snapshots.
// rawMetadata mirrors the windsurf profile derivation (github_login/github_email/
// windsurf_api_key/windsurf_api_server_url/windsurf_auth_status_raw/plan+user status).

const AUTH_BASE_URL = 'https://www.windsurf.com'
const REGISTER_API_BASE_URL = 'https://register.windsurf.com'
const DEFAULT_API_SERVER_URL = 'https://server.codeium.com'
const CLIENT_ID = '3GUryQ7ldAeKEuD2obYnppsnmj58eP5u'
const APP_USER_AGENT = 'haoxiaoguan'
const CALLBACK_PATH = '/windsurf-auth-callback'
const OAUTH_TIMEOUT_MS = 600_000

interface PendingWindsurf {
  server: LoopbackServer
  stateToken: string
  callback: Promise<CallbackPayload>
  expiresAt: number
}

function str(root: unknown, keys: string[]): string | undefined {
  if (root === null || typeof root !== 'object') return undefined
  const obj = root as Record<string, unknown>
  for (const key of keys) {
    const v = obj[key]
    if (typeof v === 'string' && v.trim().length > 0) return v.trim()
    if (typeof v === 'number') return String(v)
  }
  return undefined
}

function sanitizeLogin(raw: string): string {
  const text = raw.trim().toLowerCase()
  if (text.length === 0) return 'windsurf_user'
  const mapped = Array.from(text)
    .map((ch) => (/[a-z0-9._-]/.test(ch) ? ch : '_'))
    .join('')
  return mapped.replace(/^_+|_+$/g, '') || 'windsurf_user'
}

export class WindsurfOAuthCapability implements OAuthCapability {
  private readonly pending = new Map<string, PendingWindsurf>()
  private readonly authBaseUrl: string
  private readonly registerApiBaseUrl: string
  private readonly transport: OAuthFetch

  constructor(opts?: { authBaseUrl?: string; registerApiBaseUrl?: string; transport?: OAuthFetch }) {
    this.authBaseUrl = opts?.authBaseUrl ?? AUTH_BASE_URL
    this.registerApiBaseUrl = opts?.registerApiBaseUrl ?? REGISTER_API_BASE_URL
    this.transport = opts?.transport ?? dispatcherFetch
  }

  provider(): PlatformId {
    return 'windsurf'
  }

  async startOAuth(mode: OAuthMode): Promise<OAuthPending> {
    if (mode !== 'loopback_pkce') {
      throw CredentialError.unsupportedSource('windsurf', 'oauth')
    }
    const server = new LoopbackServer()
    let boundPort: number
    try {
      boundPort = await server.tryBind([EPHEMERAL_PORT])
    } catch {
      throw CredentialError.oauthPortInUse(0)
    }
    const pendingId = randomUUID()
    const stateToken = token32()
    const redirectUri = `http://127.0.0.1:${boundPort}${CALLBACK_PATH}`
    const params = new URLSearchParams({
      response_type: 'token',
      client_id: CLIENT_ID,
      redirect_uri: redirectUri,
      state: stateToken,
      prompt: 'login',
      redirect_parameters_type: 'query',
      workflow: 'onboarding',
    })
    const authorizeUrl = `${this.authBaseUrl}/windsurf/signin?${params.toString()}`
    const callback = server.registerPath(CALLBACK_PATH)

    this.pending.set(pendingId, {
      server,
      stateToken,
      callback,
      expiresAt: Date.now() + OAUTH_TIMEOUT_MS,
    })

    return {
      pendingId,
      authorizeUrl,
      redirectPath: CALLBACK_PATH,
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
          () => reject(CredentialError.providerError('Windsurf login timed out, please retry')),
          Math.max(0, state.expiresAt - Date.now()),
        )
      })
      let payload: CallbackPayload
      try {
        payload = await Promise.race([state.callback, timeout])
      } catch (e) {
        const direct = normalizeNonEmpty(code)
        if (!direct) throw e
        payload = { path: CALLBACK_PATH, query: { access_token: direct } }
      }

      if (payload.query.error !== undefined) {
        throw CredentialError.providerError(
          `Windsurf authorization failed: ${payload.query.error_description ?? payload.query.error}`,
        )
      }
      const callbackState = payload.query.state
      if (callbackState !== undefined && callbackState !== state.stateToken) {
        throw CredentialError.providerError('OAuth state validation failed, please retry')
      }
      const firebaseToken = normalizeNonEmpty(payload.query.access_token) ?? normalizeNonEmpty(code)
      if (!firebaseToken) {
        throw CredentialError.invalidCredential('Windsurf callback missing access_token')
      }

      return await this.buildMaterialFromFirebaseToken(firebaseToken)
    } finally {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle)
      await state.server.close().catch(() => undefined)
      this.pending.delete(pendingId)
    }
  }

  private async buildMaterialFromFirebaseToken(
    firebaseIdToken: string,
  ): Promise<ImportedCredentialMaterial> {
    const register = await this.registerUser(firebaseIdToken)
    const authToken = await this.getOneTimeAuthToken(register.apiServerUrl, firebaseIdToken)
    const currentUser = authToken
      ? await this.seatManagement(register.apiServerUrl, 'GetCurrentUser', {
          authToken,
          includeSubscription: true,
        })
      : undefined
    const planStatus = authToken
      ? await this.seatManagement(register.apiServerUrl, 'GetPlanStatus', {
          authToken,
          includeTopUpStatus: true,
        })
      : undefined
    const userStatus = await this.seatManagement(register.apiServerUrl, 'GetUserStatus', {
      metadata: this.userStatusMetadata(register.apiKey),
    })

    const user = currentUser?.user as Record<string, unknown> | undefined
    const userStatusInner = userStatus?.userStatus as Record<string, unknown> | undefined
    const email = str(user, ['email']) ?? str(userStatusInner, ['email'])
    const name = str(user, ['name']) ?? str(userStatusInner, ['name']) ?? register.name
    const username = str(user, ['username']) ?? str(userStatusInner, ['username'])
    const userId = str(user, ['id']) ?? str(userStatusInner, ['id'])

    const loginSeed =
      username ?? (email ? email.split('@')[0] : undefined) ?? name ?? 'windsurf_user'
    const githubLogin = sanitizeLogin(loginSeed)

    const planInfo =
      (planStatus?.planInfo as JsonValue | undefined) ??
      (userStatus?.planInfo as JsonValue | undefined) ??
      null
    const planName = str(planInfo, ['planName', 'plan_name', 'teamsTier'])

    const authStatusRaw: Record<string, JsonValue> = {
      apiKey: register.apiKey,
      apiServerUrl: register.apiServerUrl,
    }
    if (name) authStatusRaw.name = name
    if (email) authStatusRaw.email = email

    const rawMetadata: JsonValue = {
      email: email ?? githubLogin,
      github_login: githubLogin,
      github_email: email ?? null,
      github_name: name ?? null,
      github_id: userId ?? null,
      github_token_type: 'Bearer',
      copilot_plan: planName ?? null,
      windsurf_api_key: register.apiKey,
      windsurf_api_server_url: register.apiServerUrl,
      windsurf_auth_token: authToken ?? null,
      windsurf_token_type: 'Bearer',
      windsurf_user_status: (userStatus ?? null) as JsonValue,
      windsurf_plan_status: (planStatus ?? null) as JsonValue,
      windsurf_auth_status_raw: authStatusRaw,
    }

    return {
      provider: 'windsurf',
      email: email ?? githubLogin,
      accessToken: firebaseIdToken,
      refreshToken: undefined,
      expiresAt: undefined,
      source: 'oauth',
      rawMetadata,
    }
  }

  private async registerUser(
    firebaseIdToken: string,
  ): Promise<{ apiKey: string; apiServerUrl: string; name: string | undefined }> {
    const value = await this.seatManagement(this.registerApiBaseUrl, 'RegisterUser', {
      firebase_id_token: firebaseIdToken,
    })
    const apiKey = str(value, ['apiKey', 'api_key'])
    if (!apiKey) {
      throw CredentialError.providerError('Windsurf RegisterUser response missing apiKey')
    }
    return {
      apiKey,
      apiServerUrl: str(value, ['apiServerUrl', 'api_server_url']) ?? DEFAULT_API_SERVER_URL,
      name: str(value, ['name']),
    }
  }

  private async getOneTimeAuthToken(
    apiServerUrl: string,
    firebaseIdToken: string,
  ): Promise<string | undefined> {
    const value = await this.seatManagement(apiServerUrl, 'GetOneTimeAuthToken', {
      firebaseIdToken,
    })
    return str(value, ['authToken', 'auth_token'])
  }

  private userStatusMetadata(apiKey: string): JsonValue {
    const normalizedOs = osPlatform() === 'darwin' ? 'darwin' : osPlatform()
    return {
      apiKey,
      ideName: 'Windsurf',
      ideVersion: '1.0.0',
      extensionName: 'codeium.windsurf',
      extensionVersion: '1.0.0',
      locale: 'zh-CN',
      os: normalizedOs,
      disableTelemetry: false,
      sessionId: `haoxiaoguan-${Math.floor(Date.now() / 1000)}`,
      requestId: String(Math.floor(Date.now() / 1000)),
    }
  }

  private async seatManagement(
    baseUrl: string,
    method: string,
    body: JsonValue,
  ): Promise<Record<string, unknown> | undefined> {
    const base = baseUrl.trim().replace(/\/$/, '')
    const url = `${base}/exa.seat_management_pb.SeatManagementService/${method}`
    let resp: Response
    try {
      resp = await this.transport(url, {
        method: 'POST',
        headers: {
          'User-Agent': APP_USER_AGENT,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })
    } catch (e) {
      // RegisterUser failure is fatal (caller throws on missing apiKey); the
      // best-effort calls tolerate undefined.
      if (method === 'RegisterUser') {
        throw CredentialError.networkError(e instanceof Error ? e.message : String(e))
      }
      return undefined
    }
    if (!resp.ok) {
      if (method === 'RegisterUser') {
        throw CredentialError.providerError(`Windsurf RegisterUser returned ${resp.status}`)
      }
      return undefined
    }
    return (await resp.json().catch(() => undefined)) as Record<string, unknown> | undefined
  }
}
