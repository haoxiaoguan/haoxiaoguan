import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { arch, platform as osPlatform } from 'node:os'
import type { JsonValue } from '../../../account/domain/platform-account-profile'
import type { PlatformId } from '../../../account/domain/platform-id'
import type { OAuthCapability } from '../../domain/capabilities'
import type {
  ImportedCredentialMaterial,
  OAuthMode,
  OAuthPending,
} from '../../domain/capability-types'
import { CredentialError } from '../../domain/credential-error'
import { parseExpiresAt } from '../scan-helpers'
import { dispatcherFetch, normalizeNonEmpty, sleep, type OAuthFetch } from './oauth-http'

// Qoder OAuth (browser device flow + PKCE-S256 + server poll, no loopback).
// Ported from cockpit-tools modules/qoder_oauth.rs:
//   1. generate PKCE verifier/challenge + nonce,
//   2. open https://qoder.com/device/selectAccounts?nonce=&challenge=&challenge_method=S256&client_id=,
//   3. poll GET openapi.qoder.sh/api/v1/deviceToken/poll?nonce=&verifier=&challenge_method= (404 = pending),
//   4. GET /api/v1/userinfo (Bearer) → id/name/email; best-effort /api/v3/user/status (Cosy headers).
// rawMetadata mirrors the qoder profile derivation (user_id/display_name/
// auth_user_info_raw). The official machine-token cache is not read here (the
// optional Cosy-MachineToken header is omitted); userinfo already yields identity.

const LOGIN_BASE_URL = 'https://qoder.com/device/selectAccounts'
const OPENAPI_BASE_URL = 'https://openapi.qoder.sh'
const CLIENT_ID = 'e883ade2-e6e3-4d6d-adf7-f92ceff5fdcb'
const CHALLENGE_METHOD = 'S256'
const DEVICE_TOKEN_POLL_PATH = '/api/v1/deviceToken/poll'
const USER_INFO_PATH = '/api/v1/userinfo'
const USER_STATUS_PATH = '/api/v3/user/status'
const OAUTH_TIMEOUT_MS = 600_000
const OAUTH_POLL_INTERVAL_MS = 1_000

interface PendingQoder {
  nonce: string
  codeVerifier: string
  expiresAt: number
}

interface QoderPollResult {
  token?: string
  user_id?: string
  refresh_token?: string
  expires_at?: string
  refresh_token_expires_at?: string
}

function pkceVerifier(): string {
  return randomBytes(32).toString('base64url')
}

function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

function cosyMachineOs(): string {
  const a = arch() === 'arm64' ? 'aarch64' : arch()
  const o = osPlatform() === 'darwin' ? 'darwin' : osPlatform() === 'win32' ? 'windows' : osPlatform()
  return `${a}_${o}`
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : undefined
}

export class QoderOAuthCapability implements OAuthCapability {
  private readonly pending = new Map<string, PendingQoder>()
  private readonly loginBaseUrl: string
  private readonly openapiBaseUrl: string
  private readonly transport: OAuthFetch

  constructor(opts?: { loginBaseUrl?: string; openapiBaseUrl?: string; transport?: OAuthFetch }) {
    this.loginBaseUrl = opts?.loginBaseUrl ?? LOGIN_BASE_URL
    this.openapiBaseUrl = opts?.openapiBaseUrl ?? OPENAPI_BASE_URL
    this.transport = opts?.transport ?? dispatcherFetch
  }

  provider(): PlatformId {
    return 'qoder'
  }

  async startOAuth(mode: OAuthMode): Promise<OAuthPending> {
    if (mode !== 'loopback_pkce') {
      throw CredentialError.unsupportedSource('qoder', 'oauth')
    }
    const nonce = randomUUID().replace(/-/g, '')
    const codeVerifier = pkceVerifier()
    const challenge = pkceChallenge(codeVerifier)
    const params = new URLSearchParams({
      nonce,
      challenge,
      challenge_method: CHALLENGE_METHOD,
      client_id: CLIENT_ID,
    })
    const authorizeUrl = `${this.loginBaseUrl}?${params.toString()}`

    const pendingId = randomUUID()
    this.pending.set(pendingId, { nonce, codeVerifier, expiresAt: Date.now() + OAUTH_TIMEOUT_MS })

    return {
      pendingId,
      authorizeUrl,
      redirectPath: '/device/selectAccounts',
      boundPort: undefined,
      state: nonce,
      codeVerifier,
    }
  }

  async completeOAuth(pendingId: string, _code: string): Promise<ImportedCredentialMaterial> {
    const state = this.pending.get(pendingId)
    if (!state) {
      throw CredentialError.internal(`pending oauth ${pendingId} not found`)
    }
    try {
      for (;;) {
        if (Date.now() > state.expiresAt) {
          throw CredentialError.providerError('Qoder login polling timed out, please retry')
        }
        const tokenData = await this.pollOnce(state.nonce, state.codeVerifier)
        if (tokenData) {
          const accessToken = normalizeNonEmpty(tokenData.token)
          if (!accessToken) {
            throw CredentialError.invalidCredential('Qoder device token response missing token')
          }
          return await this.buildMaterial(accessToken, tokenData)
        }
        await sleep(OAUTH_POLL_INTERVAL_MS)
      }
    } finally {
      this.pending.delete(pendingId)
    }
  }

  private async pollOnce(nonce: string, verifier: string): Promise<QoderPollResult | undefined> {
    const params = new URLSearchParams({ nonce, verifier, challenge_method: CHALLENGE_METHOD })
    const url = `${this.openapiBaseUrl}${DEVICE_TOKEN_POLL_PATH}?${params.toString()}`
    let resp: Response
    try {
      resp = await this.transport(url, { headers: { Accept: 'application/json' } })
    } catch (e) {
      throw CredentialError.networkError(e instanceof Error ? e.message : String(e))
    }
    if (resp.status === 404) return undefined
    if (!resp.ok) {
      throw CredentialError.providerError(`Qoder deviceToken/poll returned ${resp.status}`)
    }
    const body = (await resp.json().catch(() => undefined)) as QoderPollResult | undefined
    return normalizeNonEmpty(body?.token) ? body : undefined
  }

  private async buildMaterial(
    accessToken: string,
    tokenData: QoderPollResult,
  ): Promise<ImportedCredentialMaterial> {
    const userInfo = await this.fetchJson(USER_INFO_PATH, accessToken, {})
    const userStatus = await this.fetchJson(USER_STATUS_PATH, accessToken, {
      'Cosy-MachineOS': cosyMachineOs(),
      'Cosy-ClientType': '0',
    })

    const merged: Record<string, unknown> = {
      id: str(userInfo?.id) ?? tokenData.user_id ?? null,
      token: accessToken,
      name: str(userInfo?.name) ?? str(userStatus?.name) ?? null,
      email: str(userInfo?.email) ?? str(userStatus?.email) ?? null,
      avatarUrl: str(userInfo?.avatarUrl) ?? null,
    }
    if (tokenData.refresh_token) merged.refreshToken = tokenData.refresh_token
    if (userStatus) {
      merged.quota = userStatus.quota ?? null
      merged.userType = userStatus.userType ?? null
      merged.orgId = userStatus.orgId ?? null
      merged.orgName = userStatus.orgName ?? null
    }

    const userId = normalizeNonEmpty(str(merged.id)) ?? normalizeNonEmpty(tokenData.user_id)
    const email = normalizeNonEmpty(str(merged.email)) ?? userId ?? 'qoder-user'
    const displayName = normalizeNonEmpty(str(merged.name))
    const refreshToken = normalizeNonEmpty(tokenData.refresh_token)
    const expiresAt = parseExpiresAt(tokenData.expires_at)

    const rawMetadata: JsonValue = {
      email,
      user_id: userId ?? null,
      display_name: displayName ?? null,
      auth_user_info_raw: merged as JsonValue,
      auth_user_plan_raw: (userStatus ?? null) as JsonValue,
    }

    return {
      provider: 'qoder',
      email,
      accessToken,
      refreshToken,
      expiresAt,
      source: 'oauth',
      rawMetadata,
    }
  }

  private async fetchJson(
    path: string,
    accessToken: string,
    extraHeaders: Record<string, string>,
  ): Promise<Record<string, unknown> | undefined> {
    try {
      const resp = await this.transport(`${this.openapiBaseUrl}${path}`, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', ...extraHeaders },
      })
      if (!resp.ok) return undefined
      return (await resp.json().catch(() => undefined)) as Record<string, unknown> | undefined
    } catch {
      return undefined
    }
  }
}
