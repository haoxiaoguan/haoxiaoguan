import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { JsonValue } from '../../../account/domain/platform-account-profile'
import type { PlatformId } from '../../../account/domain/platform-id'
import type { OAuthCapability } from '../../domain/capabilities'
import type {
  ImportedCredentialMaterial,
  OAuthMode,
  OAuthPending,
} from '../../domain/capability-types'
import { CredentialError } from '../../domain/credential-error'

// Cursor OAuth capability.
//
// Cursor uses a poll-based flow (no loopback server): start_oauth builds a
// loginDeepControl URL with a PKCE challenge + login uuid; complete_oauth polls
// https://api2.cursor.sh/auth/poll until tokens appear (2s interval, 300s
// timeout). Endpoints are overridable via env for tests.

const CURSOR_LOGIN_URL = 'https://cursor.com/loginDeepControl'
const CURSOR_POLL_ENDPOINT = 'https://api2.cursor.sh/auth/poll'
const OAUTH_TIMEOUT_MS = 300_000
const OAUTH_POLL_INTERVAL_MS = 2_000

interface PendingCursor {
  uuid: string
  codeVerifier: string
  expiresAt: number
}

function base64UrlToken(bytesLen: number): string {
  return randomBytes(bytesLen).toString('base64url')
}

function pkceChallenge(codeVerifier: string): string {
  return createHash('sha256').update(codeVerifier).digest('base64url')
}

function normalizeNonEmpty(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined
  const t = value.trim()
  return t.length > 0 ? t : undefined
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export class CursorOAuthCapability implements OAuthCapability {
  private readonly pending = new Map<string, PendingCursor>()
  private readonly loginUrl: string
  private readonly pollEndpoint: string

  constructor() {
    this.loginUrl = process.env.HAOXIAOGUAN_CURSOR_LOGIN_URL ?? CURSOR_LOGIN_URL
    this.pollEndpoint = process.env.HAOXIAOGUAN_CURSOR_POLL_ENDPOINT ?? CURSOR_POLL_ENDPOINT
  }

  provider(): PlatformId {
    return 'cursor'
  }

  async startOAuth(mode: OAuthMode): Promise<OAuthPending> {
    if (mode !== 'loopback_pkce') {
      throw CredentialError.unsupportedSource('cursor', 'oauth')
    }
    const pendingId = randomUUID()
    const loginUuid = randomUUID()
    const codeVerifier = base64UrlToken(32)
    const codeChallenge = pkceChallenge(codeVerifier)
    const authorizeUrl =
      `${this.loginUrl}?challenge=${encodeURIComponent(codeChallenge)}` +
      `&uuid=${encodeURIComponent(loginUuid)}&mode=login`

    this.pending.set(pendingId, {
      uuid: loginUuid,
      codeVerifier,
      expiresAt: Date.now() + OAUTH_TIMEOUT_MS,
    })

    return {
      pendingId,
      authorizeUrl,
      redirectPath: '/oauth/cursor',
      boundPort: undefined,
      state: loginUuid,
      codeVerifier,
    }
  }

  async completeOAuth(pendingId: string, _code: string): Promise<ImportedCredentialMaterial> {
    for (;;) {
      const state = this.pending.get(pendingId)
      if (!state) {
        throw CredentialError.internal(`pending oauth ${pendingId} not found`)
      }
      if (Date.now() > state.expiresAt) {
        this.pending.delete(pendingId)
        throw CredentialError.providerError('Cursor login polling timed out, please retry')
      }

      const pollUrl =
        `${this.pollEndpoint}?uuid=${encodeURIComponent(state.uuid)}` +
        `&verifier=${encodeURIComponent(state.codeVerifier)}`
      let resp: Response
      try {
        resp = await fetch(pollUrl, { headers: { Accept: 'application/json' } })
      } catch (e) {
        throw CredentialError.networkError(e instanceof Error ? e.message : String(e))
      }
      if (!resp.ok) {
        await sleep(OAUTH_POLL_INTERVAL_MS)
        continue
      }
      const body = await resp.text()
      // Cursor 的 auth/poll 返回**驼峰** accessToken/refreshToken/authId（对照 cockpit-tools
      // cursor_oauth.rs PollResponse 的 #[serde(rename_all = "camelCase")]）。此前只读下划线
      // access_token/refresh_token → 永远取不到 token → 一直轮询到 300s 超时 → OAuth 导入失败。
      // 兼容两种拼写：驼峰优先、下划线兜底。
      let poll: {
        access_token?: string
        accessToken?: string
        refresh_token?: string
        refreshToken?: string
        auth_id?: string
        authId?: string
      }
      try {
        poll = JSON.parse(body)
      } catch (e) {
        throw CredentialError.invalidCredential(
          `parse Cursor OAuth poll response failed: ${e instanceof Error ? e.message : String(e)}`,
        )
      }
      const accessToken = normalizeNonEmpty(poll.accessToken ?? poll.access_token)
      const refreshToken = normalizeNonEmpty(poll.refreshToken ?? poll.refresh_token)
      if (!accessToken || !refreshToken) {
        await sleep(OAUTH_POLL_INTERVAL_MS)
        continue
      }

      this.pending.delete(pendingId)
      const authId = normalizeNonEmpty(poll.authId ?? poll.auth_id)
      const email = authId ?? `cursor-${state.uuid}`
      return {
        provider: 'cursor',
        email,
        accessToken,
        refreshToken,
        expiresAt: undefined,
        source: 'oauth',
        rawMetadata: buildCursorRawMetadata(email, authId, accessToken, refreshToken),
      }
    }
  }
}

function buildCursorRawMetadata(
  email: string,
  authId: string | undefined,
  accessToken: string,
  refreshToken: string,
): JsonValue {
  const authRaw: Record<string, JsonValue> = {
    accessToken,
    refreshToken,
    email,
  }
  const normalizedAuthId = normalizeNonEmpty(authId)
  if (normalizedAuthId) {
    authRaw.authId = normalizedAuthId
    authRaw.auth_id = normalizedAuthId
  }
  return {
    email,
    auth_id: normalizedAuthId ?? null,
    cursor_auth_raw: authRaw,
  }
}
