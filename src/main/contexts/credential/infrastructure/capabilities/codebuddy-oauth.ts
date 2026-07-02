import { randomUUID } from 'node:crypto'
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

// CodeBuddy OAuth (server-side poll, no loopback / no PKCE). Ported from
// cockpit-tools modules/codebuddy_oauth.rs (shared by the international `.ai`
// and China `.cn` deployments — only the base URL differs).
//
//   1. POST {base}/v2/plugin/auth/state?platform=ide → { state, authUrl }
//   2. open authUrl (or {base}/login?state=)
//   3. poll GET {base}/v2/plugin/auth/token?state= until code 0/200 + accessToken
//   4. GET {base}/v2/plugin/login/account?state= (Bearer + X-Domain) → identity
//
// rawMetadata mirrors the codebuddy profile derivation (uid/nickname/enterprise/
// domain/auth_raw/profile_raw).

const CODEBUDDY_INTL_BASE = 'https://www.codebuddy.ai'
const CODEBUDDY_CN_BASE = 'https://www.codebuddy.cn'
const API_PREFIX = '/v2/plugin'
const PLATFORM = 'ide'
const OAUTH_TIMEOUT_MS = 600_000
const OAUTH_POLL_INTERVAL_MS = 1_500

interface PendingCodebuddy {
  state: string
  expiresAt: number
}

export class CodebuddyOAuthCapability implements OAuthCapability {
  private readonly pending = new Map<string, PendingCodebuddy>()
  private readonly baseUrl: string
  private readonly transport: OAuthFetch

  constructor(
    private readonly platform: PlatformId,
    opts?: { baseUrl?: string; transport?: OAuthFetch },
  ) {
    this.baseUrl = opts?.baseUrl ?? (platform === 'codebuddy_cn' ? CODEBUDDY_CN_BASE : CODEBUDDY_INTL_BASE)
    this.transport = opts?.transport ?? dispatcherFetch
  }

  provider(): PlatformId {
    return this.platform
  }

  async startOAuth(mode: OAuthMode): Promise<OAuthPending> {
    if (mode !== 'loopback_pkce') {
      throw CredentialError.unsupportedSource(this.platform, 'oauth')
    }
    const url = `${this.baseUrl}${API_PREFIX}/auth/state?platform=${PLATFORM}`
    let resp: Response
    try {
      resp = await this.transport(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: '{}',
      })
    } catch (e) {
      throw CredentialError.networkError(e instanceof Error ? e.message : String(e))
    }
    if (!resp.ok) {
      throw CredentialError.providerError(`CodeBuddy auth/state returned ${resp.status}`)
    }
    const body = (await resp.json().catch(() => undefined)) as
      | { data?: { state?: string; authUrl?: string; auth_url?: string; url?: string } }
      | undefined
    const data = body?.data
    const state = normalizeNonEmpty(data?.state)
    if (!state) {
      throw CredentialError.invalidCredential('CodeBuddy auth/state response missing state')
    }
    const authorizeUrl =
      normalizeNonEmpty(data?.authUrl ?? data?.auth_url ?? data?.url) ??
      `${this.baseUrl}/login?state=${encodeURIComponent(state)}`

    const pendingId = randomUUID()
    this.pending.set(pendingId, { state, expiresAt: Date.now() + OAUTH_TIMEOUT_MS })

    return {
      pendingId,
      authorizeUrl,
      redirectPath: '/login',
      boundPort: undefined,
      state,
      codeVerifier: '',
    }
  }

  async completeOAuth(pendingId: string, _code: string): Promise<ImportedCredentialMaterial> {
    const state = this.pending.get(pendingId)
    if (!state) {
      throw CredentialError.internal(`pending oauth ${pendingId} not found`)
    }
    try {
      const tokenUrl = `${this.baseUrl}${API_PREFIX}/auth/token?state=${encodeURIComponent(state.state)}`
      for (;;) {
        if (Date.now() > state.expiresAt) {
          throw CredentialError.providerError('CodeBuddy login polling timed out, please retry')
        }
        let data: Record<string, unknown> | undefined
        try {
          const resp = await this.transport(tokenUrl, { headers: { Accept: 'application/json' } })
          if (resp.ok) {
            const body = (await resp.json().catch(() => undefined)) as
              | { code?: number; data?: Record<string, unknown> }
              | undefined
            const code = typeof body?.code === 'number' ? body.code : -1
            if (code === 0 || code === 200) data = body?.data
          }
        } catch (e) {
          throw CredentialError.networkError(e instanceof Error ? e.message : String(e))
        }
        const accessToken = data ? normalizeNonEmpty(str(data.accessToken) ?? str(data.access_token)) : undefined
        if (data && accessToken) {
          return await this.buildMaterial(state.state, accessToken, data)
        }
        await sleep(OAUTH_POLL_INTERVAL_MS)
      }
    } finally {
      this.pending.delete(pendingId)
    }
  }

  private async buildMaterial(
    state: string,
    accessToken: string,
    tokenData: Record<string, unknown>,
  ): Promise<ImportedCredentialMaterial> {
    const refreshToken = normalizeNonEmpty(str(tokenData.refreshToken) ?? str(tokenData.refresh_token))
    const domain = normalizeNonEmpty(str(tokenData.domain))
    const tokenType = normalizeNonEmpty(str(tokenData.tokenType) ?? str(tokenData.token_type))
    const expiresRaw = tokenData.expiresAt ?? tokenData.expires_at
    const expiresAt = parseExpiresAt(expiresRaw)

    const account = await this.fetchAccount(state, accessToken, domain)
    const uid = normalizeNonEmpty(str(account?.uid))
    const nickname = normalizeNonEmpty(str(account?.nickname))
    const enterpriseId = normalizeNonEmpty(str(account?.enterpriseId))
    const enterpriseName = normalizeNonEmpty(str(account?.enterpriseName))
    const email =
      normalizeNonEmpty(str(account?.email)) ?? nickname ?? uid ?? `${this.platform}-user`

    const rawMetadata: JsonValue = {
      email,
      uid: uid ?? null,
      nickname: nickname ?? null,
      enterprise_id: enterpriseId ?? null,
      enterprise_name: enterpriseName ?? null,
      domain: domain ?? null,
      access_token: accessToken,
      refresh_token: refreshToken ?? null,
      token_type: tokenType ?? null,
      expires_at: expiresAt ? Math.floor(expiresAt.getTime() / 1000) : null,
      auth_raw: tokenData as JsonValue,
      profile_raw: (account ?? null) as JsonValue,
    }

    return {
      provider: this.platform,
      email,
      accessToken,
      refreshToken,
      expiresAt,
      source: 'oauth',
      rawMetadata,
    }
  }

  private async fetchAccount(
    state: string,
    accessToken: string,
    domain: string | undefined,
  ): Promise<Record<string, unknown> | undefined> {
    try {
      const url = `${this.baseUrl}${API_PREFIX}/login/account?state=${encodeURIComponent(state)}`
      const headers: Record<string, string> = {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      }
      if (domain) headers['X-Domain'] = domain
      const resp = await this.transport(url, { headers })
      if (!resp.ok) return undefined
      const body = (await resp.json().catch(() => undefined)) as
        | { data?: Record<string, unknown> }
        | undefined
      return body?.data
    } catch {
      return undefined
    }
  }
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}
