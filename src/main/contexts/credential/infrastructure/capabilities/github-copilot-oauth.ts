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

// GitHub Copilot OAuth capability. Uses GitHub's device flow:
// start_oauth requests a device code (returns the verification URI as the
// authorize URL + the user_code as state); complete_oauth polls the token
// endpoint until the user authorises, then fetches the GitHub user + Copilot
// token for raw_metadata. Endpoints overridable via env for tests.

const DEVICE_CODE_ENDPOINT = 'https://github.com/login/device/code'
const DEVICE_TOKEN_ENDPOINT = 'https://github.com/login/oauth/access_token'
const USER_ENDPOINT = 'https://api.github.com/user'
const USER_EMAILS_ENDPOINT = 'https://api.github.com/user/emails'
const COPILOT_TOKEN_ENDPOINT = 'https://api.github.com/copilot_internal/v2/token'
const COPILOT_USER_INFO_ENDPOINT = 'https://api.github.com/copilot_internal/user'
const CLIENT_ID = '01ab8ac9400c4e429b23'
const SCOPE = 'read:user user:email repo workflow'
const USER_AGENT = 'haoxiaoguan'

const env = (key: string, fallback: string): string => process.env[key] ?? fallback
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function normalizeNonEmpty(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined
  const t = value.trim()
  return t.length > 0 ? t : undefined
}

interface PendingDevice {
  deviceCode: string
  intervalSeconds: number
  expiresAt: number
}

export class GitHubCopilotOAuthCapability implements OAuthCapability {
  private readonly pending = new Map<string, PendingDevice>()
  private readonly deviceCodeEndpoint = env('HAOXIAOGUAN_GITHUB_DEVICE_CODE_ENDPOINT', DEVICE_CODE_ENDPOINT)
  private readonly deviceTokenEndpoint = env('HAOXIAOGUAN_GITHUB_DEVICE_TOKEN_ENDPOINT', DEVICE_TOKEN_ENDPOINT)
  private readonly userEndpoint = env('HAOXIAOGUAN_GITHUB_USER_ENDPOINT', USER_ENDPOINT)
  private readonly userEmailsEndpoint = env('HAOXIAOGUAN_GITHUB_USER_EMAILS_ENDPOINT', USER_EMAILS_ENDPOINT)
  private readonly copilotTokenEndpoint = env('HAOXIAOGUAN_GITHUB_COPILOT_TOKEN_ENDPOINT', COPILOT_TOKEN_ENDPOINT)
  private readonly copilotUserInfoEndpoint = env('HAOXIAOGUAN_GITHUB_COPILOT_USER_INFO_ENDPOINT', COPILOT_USER_INFO_ENDPOINT)

  provider(): PlatformId {
    return 'github_copilot'
  }

  async startOAuth(mode: OAuthMode): Promise<OAuthPending> {
    if (mode !== 'loopback_pkce') {
      throw CredentialError.unsupportedSource('github_copilot', 'oauth')
    }
    let resp: Response
    try {
      resp = await fetch(this.deviceCodeEndpoint, {
        method: 'POST',
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        body: new URLSearchParams({ client_id: CLIENT_ID, scope: SCOPE }),
      })
    } catch (e) {
      throw CredentialError.networkError(e instanceof Error ? e.message : String(e))
    }
    if (!resp.ok) {
      throw CredentialError.providerError(`request GitHub device code failed: status=${resp.status}`)
    }
    const payload = (await resp.json()) as {
      device_code: string
      user_code: string
      verification_uri: string
      verification_uri_complete?: string
      expires_in: number
      interval?: number
    }
    const pendingId = randomUUID()
    const intervalSeconds = Math.max(1, payload.interval ?? 5)
    const authorizeUrl = payload.verification_uri_complete ?? payload.verification_uri

    this.pending.set(pendingId, {
      deviceCode: payload.device_code,
      intervalSeconds,
      expiresAt: Date.now() + payload.expires_in * 1000,
    })

    return {
      pendingId,
      authorizeUrl,
      redirectPath: '/oauth/github-copilot/device',
      boundPort: undefined,
      state: payload.user_code,
      codeVerifier: '',
    }
  }

  async completeOAuth(pendingId: string, _code: string): Promise<ImportedCredentialMaterial> {
    const pending = this.pending.get(pendingId)
    if (!pending) throw CredentialError.internal(`pending oauth ${pendingId} not found`)
    let interval = pending.intervalSeconds

    let accessToken: string | undefined
    for (;;) {
      if (Date.now() >= pending.expiresAt) {
        this.pending.delete(pendingId)
        throw CredentialError.providerError('waiting for GitHub authorization timed out, please retry')
      }
      let resp: Response
      try {
        resp = await fetch(this.deviceTokenEndpoint, {
          method: 'POST',
          headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
          body: new URLSearchParams({
            client_id: CLIENT_ID,
            device_code: pending.deviceCode,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          }),
        })
      } catch (e) {
        throw CredentialError.networkError(e instanceof Error ? e.message : String(e))
      }
      if (!resp.ok) {
        throw CredentialError.providerError(`request GitHub access token failed: status=${resp.status}`)
      }
      const token = (await resp.json()) as {
        access_token?: string
        error?: string
        error_description?: string
      }
      if (token.access_token) {
        accessToken = token.access_token
        break
      }
      switch (token.error) {
        case 'authorization_pending':
          await sleep(interval * 1000)
          break
        case 'slow_down':
          interval += 5
          await sleep(interval * 1000)
          break
        case 'expired_token':
          this.pending.delete(pendingId)
          throw CredentialError.providerError('authorization code expired, please retry')
        case 'access_denied':
          this.pending.delete(pendingId)
          throw CredentialError.providerError('user cancelled GitHub authorization')
        case undefined:
          await sleep(interval * 1000)
          break
        default:
          this.pending.delete(pendingId)
          throw CredentialError.providerError(
            `GitHub authorization failed: ${token.error} (${token.error_description ?? 'unknown error'})`,
          )
      }
    }

    const user = await this.fetchUser(accessToken)
    const email = user.email ?? (await this.fetchPrimaryEmail(accessToken))
    const copilot = await this.fetchCopilotDetails(accessToken)
    this.pending.delete(pendingId)

    const resolvedEmail =
      normalizeNonEmpty(email) ?? normalizeNonEmpty(user.login) ?? `github-${user.id}`

    const rawMetadata: JsonValue = {
      github_login: user.login,
      github_id: user.id,
      github_name: user.name ?? null,
      github_email: email ?? null,
      github_access_token: accessToken,
      copilot_token: copilot.token ?? null,
      copilot_plan: copilot.plan ?? null,
      copilot_chat_enabled: copilot.chatEnabled ?? null,
      copilot_expires_at: copilot.expiresAt ?? null,
    }

    return {
      provider: 'github_copilot',
      email: resolvedEmail,
      accessToken,
      refreshToken: undefined,
      expiresAt: undefined,
      source: 'oauth',
      rawMetadata,
    }
  }

  private async fetchUser(token: string): Promise<{ id: number; login: string; name?: string; email?: string }> {
    const resp = await fetch(this.userEndpoint, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', Authorization: `Bearer ${token}` },
    })
    if (!resp.ok) throw CredentialError.providerError(`fetch GitHub user failed: status=${resp.status}`)
    return (await resp.json()) as { id: number; login: string; name?: string; email?: string }
  }

  private async fetchPrimaryEmail(token: string): Promise<string | undefined> {
    try {
      const resp = await fetch(this.userEmailsEndpoint, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', Authorization: `Bearer ${token}` },
      })
      if (!resp.ok) return undefined
      const emails = (await resp.json()) as Array<{ email: string; primary?: boolean; verified?: boolean }>
      const primary = emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified) ?? emails[0]
      return primary?.email
    } catch {
      return undefined
    }
  }

  private async fetchCopilotDetails(
    token: string,
  ): Promise<{ token?: string | undefined; plan?: string | undefined; chatEnabled?: boolean | undefined; expiresAt?: number | undefined }> {
    try {
      const tokenResp = await fetch(this.copilotTokenEndpoint, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', Authorization: `Bearer ${token}` },
      })
      const copilotToken = tokenResp.ok
        ? ((await tokenResp.json()) as { token?: string; expires_at?: number; chat_enabled?: boolean })
        : {}
      const infoResp = await fetch(this.copilotUserInfoEndpoint, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', Authorization: `Bearer ${token}` },
      })
      const info = infoResp.ok ? ((await infoResp.json()) as { copilot_plan?: string }) : {}
      return {
        token: copilotToken.token,
        plan: info.copilot_plan,
        chatEnabled: copilotToken.chat_enabled,
        expiresAt: copilotToken.expires_at,
      }
    } catch {
      return {}
    }
  }
}
