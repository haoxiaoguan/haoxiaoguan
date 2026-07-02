import { describe, it, expect } from 'vitest'
import { CodexOAuthCapability } from '../../../src/main/contexts/credential/infrastructure/capabilities/codex-oauth'
import { CredentialError } from '../../../src/main/contexts/credential/domain/credential-error'

// Codex OAuth capability tests — loopback PKCE flow with an injected token
// transport (no real network) and non-default callback ports (1455 may be taken
// on dev machines running the real Codex CLI).

const TEST_PORTS = [45871, 45872, 45873, 45874]

function fakeJwt(payload: Record<string, unknown>): string {
  const enc = (obj: unknown): string => Buffer.from(JSON.stringify(obj)).toString('base64url')
  return `${enc({ alg: 'none', typ: 'JWT' })}.${enc(payload)}.fake-sig`
}

const ID_TOKEN = fakeJwt({
  email: 'user@example.com',
  'https://api.openai.com/auth': {
    chatgpt_user_id: 'user-123',
    chatgpt_plan_type: 'plus',
  },
})

const ACCESS_TOKEN = fakeJwt({
  sub: 'user-123',
  'https://api.openai.com/auth': {
    chatgpt_account_id: 'acct-456',
  },
})

interface RecordedRequest {
  url: string
  init: RequestInit
}

function makeTransport(
  status: number,
  body: Record<string, unknown>,
  recorded: RecordedRequest[],
): (url: string, init: RequestInit) => Promise<Response> {
  return async (url, init) => {
    recorded.push({ url, init })
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

describe('CodexOAuthCapability', () => {
  it('rejects non-loopback modes', async () => {
    const cap = new CodexOAuthCapability({ callbackPorts: TEST_PORTS })
    await expect(cap.startOAuth('deep_link')).rejects.toMatchObject({
      kind: 'unsupported_source',
    })
  })

  it('builds an authorize URL with the PKCE + codex parameters', async () => {
    const cap = new CodexOAuthCapability({
      callbackPorts: TEST_PORTS,
      transport: makeTransport(400, {}, []),
    })
    const pending = await cap.startOAuth('loopback_pkce')
    try {
      const url = new URL(pending.authorizeUrl)
      expect(url.origin + url.pathname).toBe('https://auth.openai.com/oauth/authorize')
      expect(url.searchParams.get('response_type')).toBe('code')
      expect(url.searchParams.get('client_id')).toBe('app_EMoamEEZ73f0CkXaXp7hrann')
      expect(url.searchParams.get('redirect_uri')).toBe(
        `http://localhost:${pending.boundPort}/auth/callback`,
      )
      expect(url.searchParams.get('scope')).toContain('openid')
      expect(url.searchParams.get('scope')).toContain('offline_access')
      expect(url.searchParams.get('code_challenge_method')).toBe('S256')
      expect(url.searchParams.get('code_challenge')).toBeTruthy()
      expect(url.searchParams.get('state')).toBe(pending.state)
      expect(url.searchParams.get('originator')).toBe('codex_vscode')
      expect(url.searchParams.get('codex_cli_simplified_flow')).toBe('true')
      expect(pending.redirectPath).toBe('/auth/callback')
      expect(TEST_PORTS).toContain(pending.boundPort)
    } finally {
      // Drive the flow to completion (mock 400) so the loopback port is released.
      const completion = cap.completeOAuth(pending.pendingId, '')
      const settled = completion.catch(() => undefined)
      await fetch(
        `http://127.0.0.1:${pending.boundPort}/auth/callback?code=x&state=${encodeURIComponent(pending.state)}`,
      )
      await settled
    }
  })

  it('completes the flow: callback → form-encoded code exchange → material', async () => {
    const recorded: RecordedRequest[] = []
    const cap = new CodexOAuthCapability({
      callbackPorts: TEST_PORTS,
      transport: makeTransport(
        200,
        {
          id_token: ID_TOKEN,
          access_token: ACCESS_TOKEN,
          refresh_token: 'refresh-abc',
          expires_in: 3600,
        },
        recorded,
      ),
    })

    const pending = await cap.startOAuth('loopback_pkce')
    const completion = cap.completeOAuth(pending.pendingId, '')
    const resp = await fetch(
      `http://127.0.0.1:${pending.boundPort}/auth/callback?code=auth-code-1&state=${encodeURIComponent(pending.state)}`,
    )
    expect(resp.status).toBe(200)

    const material = await completion
    expect(material.provider).toBe('codex')
    expect(material.source).toBe('oauth')
    expect(material.email).toBe('user@example.com')
    expect(material.accessToken).toBe(ACCESS_TOKEN)
    expect(material.refreshToken).toBe('refresh-abc')
    expect(material.expiresAt).toBeInstanceOf(Date)
    expect(material.expiresAt!.getTime()).toBeGreaterThan(Date.now())

    const meta = material.rawMetadata as Record<string, unknown>
    expect(meta.auth_mode).toBe('chatgpt_oauth')
    expect(meta.plan_type).toBe('plus')
    expect(meta.user_id).toBe('user-123')
    expect(meta.account_id).toBe('acct-456')
    expect(meta.id_token).toBe(ID_TOKEN)
    expect(meta.refresh_token).toBe('refresh-abc')
    const tokens = meta.tokens as Record<string, unknown>
    expect(tokens.access_token).toBe(ACCESS_TOKEN)
    expect(tokens.refresh_token).toBe('refresh-abc')

    // The exchange must be a form-urlencoded POST carrying PKCE verifier + code.
    expect(recorded).toHaveLength(1)
    expect(recorded[0].url).toBe('https://auth.openai.com/oauth/token')
    expect(recorded[0].init.method).toBe('POST')
    const headers = recorded[0].init.headers as Record<string, string>
    expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded')
    const form = new URLSearchParams(String(recorded[0].init.body))
    expect(form.get('grant_type')).toBe('authorization_code')
    expect(form.get('code')).toBe('auth-code-1')
    expect(form.get('client_id')).toBe('app_EMoamEEZ73f0CkXaXp7hrann')
    expect(form.get('code_verifier')).toBe(pending.codeVerifier)
    expect(form.get('redirect_uri')).toBe(`http://localhost:${pending.boundPort}/auth/callback`)
  })

  it('rejects a callback with a mismatched state', async () => {
    const recorded: RecordedRequest[] = []
    const cap = new CodexOAuthCapability({
      callbackPorts: TEST_PORTS,
      transport: makeTransport(200, {}, recorded),
    })
    const pending = await cap.startOAuth('loopback_pkce')
    const completion = cap.completeOAuth(pending.pendingId, '')
    const assertion = expect(completion).rejects.toThrow(/state validation failed/)
    await fetch(
      `http://127.0.0.1:${pending.boundPort}/auth/callback?code=auth-code-1&state=wrong-state`,
    )
    await assertion
    expect(recorded).toHaveLength(0)
  })

  it('surfaces provider errors returned on the callback', async () => {
    const cap = new CodexOAuthCapability({
      callbackPorts: TEST_PORTS,
      transport: makeTransport(200, {}, []),
    })
    const pending = await cap.startOAuth('loopback_pkce')
    const completion = cap.completeOAuth(pending.pendingId, '')
    const assertion = expect(completion).rejects.toThrow(/User denied/)
    await fetch(
      `http://127.0.0.1:${pending.boundPort}/auth/callback?error=access_denied&error_description=User+denied`,
    )
    await assertion
  })

  it('fails when the token response is missing access_token', async () => {
    const cap = new CodexOAuthCapability({
      callbackPorts: TEST_PORTS,
      transport: makeTransport(200, { id_token: ID_TOKEN }, []),
    })
    const pending = await cap.startOAuth('loopback_pkce')
    const completion = cap.completeOAuth(pending.pendingId, '')
    const assertion = expect(completion).rejects.toThrow(/missing access_token/)
    await fetch(
      `http://127.0.0.1:${pending.boundPort}/auth/callback?code=auth-code-1&state=${encodeURIComponent(pending.state)}`,
    )
    await assertion
  })

  it('fails with a provider error on a non-2xx token response', async () => {
    const cap = new CodexOAuthCapability({
      callbackPorts: TEST_PORTS,
      transport: makeTransport(400, { error: 'invalid_grant' }, []),
    })
    const pending = await cap.startOAuth('loopback_pkce')
    const completion = cap.completeOAuth(pending.pendingId, '')
    const assertion = expect(completion).rejects.toThrow(/oauth\/token returned an error/)
    await fetch(
      `http://127.0.0.1:${pending.boundPort}/auth/callback?code=auth-code-1&state=${encodeURIComponent(pending.state)}`,
    )
    await assertion
  })

  it('throws internal for an unknown pending id', async () => {
    const cap = new CodexOAuthCapability({ callbackPorts: TEST_PORTS })
    await expect(cap.completeOAuth('nope', 'code')).rejects.toBeInstanceOf(CredentialError)
  })
})
