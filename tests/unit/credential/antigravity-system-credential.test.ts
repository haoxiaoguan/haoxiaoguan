import { describe, it, expect } from 'vitest'
import {
  parseAntigravitySystemCredentialSecret,
  resolveAntigravitySystemCredential,
} from '../../../src/main/contexts/credential/infrastructure/capabilities/antigravity-system-credential'
import type { OAuthFetch } from '../../../src/main/contexts/credential/infrastructure/capabilities/oauth-http'

// Antigravity (legacy) >= 2.0 desktop client stores its login in the macOS
// Keychain (service "gemini", account "antigravity") as
// `go-keyring-base64:<base64 JSON>`. These tests cover the pure decode +
// live-resolve logic without touching a real Keychain or network — see
// local-import-extra.test.ts for the AntigravityLocalImportCapability
// integration (Keychain-first, fallback to state.vscdb).

function encodeSecret(payload: unknown): string {
  return `go-keyring-base64:${Buffer.from(JSON.stringify(payload)).toString('base64')}`
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function routedTransport(
  routes: Array<{ match: string; handler: () => Response }>,
): { transport: OAuthFetch; calls: string[] } {
  const calls: string[] = []
  const transport: OAuthFetch = async (url) => {
    calls.push(url)
    const route = routes.find((r) => url.includes(r.match))
    return route ? route.handler() : new Response('not found', { status: 404 })
  }
  return { transport, calls }
}

describe('parseAntigravitySystemCredentialSecret', () => {
  it('解码 go-keyring-base64: 前缀的 JSON，拿到 token 四件套', () => {
    const secret = encodeSecret({
      token: {
        access_token: 'ya29.access',
        token_type: 'Bearer',
        refresh_token: '1//refresh',
        expiry: '2026-07-03T00:13:01.309613+08:00',
      },
      auth_method: 'consumer',
    })
    const parsed = parseAntigravitySystemCredentialSecret(secret)
    expect(parsed).toEqual({
      accessToken: 'ya29.access',
      refreshToken: '1//refresh',
      tokenType: 'Bearer',
      expiryIso: '2026-07-03T00:13:01.309613+08:00',
      authMethod: 'consumer',
    })
  })

  it('缺 go-keyring-base64: 前缀 → undefined', () => {
    expect(parseAntigravitySystemCredentialSecret('plain-text-not-a-keychain-blob')).toBeUndefined()
  })

  it('base64 内不是合法 JSON → undefined', () => {
    const secret = `go-keyring-base64:${Buffer.from('not json').toString('base64')}`
    expect(parseAntigravitySystemCredentialSecret(secret)).toBeUndefined()
  })

  it('JSON 里缺 access_token → undefined', () => {
    const secret = encodeSecret({ token: { refresh_token: '1//refresh' }, auth_method: 'consumer' })
    expect(parseAntigravitySystemCredentialSecret(secret)).toBeUndefined()
  })
})

describe('resolveAntigravitySystemCredential', () => {
  it('有 refresh_token：先刷新拿新 access_token，再用它查 userinfo', async () => {
    const { transport, calls } = routedTransport([
      {
        match: '/token',
        handler: () => jsonResponse({ access_token: 'ya29.refreshed', expires_in: 3600 }),
      },
      {
        match: 'userinfo',
        handler: () => jsonResponse({ id: '104354796748987286567', email: 'a876771120@gmail.com', name: '刘勤' }),
      },
    ])
    const material = await resolveAntigravitySystemCredential(
      { accessToken: 'ya29.stale', refreshToken: '1//refresh', tokenType: 'Bearer' },
      { transport },
    )
    expect(calls).toHaveLength(2)
    expect(material?.provider).toBe('antigravity')
    expect(material?.source).toBe('local_scan')
    expect(material?.email).toBe('a876771120@gmail.com')
    expect(material?.accessToken).toBe('ya29.refreshed')
    expect(material?.refreshToken).toBe('1//refresh')
    const meta = material?.rawMetadata as Record<string, unknown>
    expect(meta.selected_auth_type).toBe('google')
    expect(meta.auth_id).toBe('104354796748987286567')
    expect((meta.antigravity_oauth_raw as Record<string, unknown>).access_token).toBe('ya29.refreshed')
    expect((meta.antigravity_user_raw as Record<string, unknown>).name).toBe('刘勤')
  })

  it('刷新失败时退回用原 access_token 查 userinfo', async () => {
    const { transport } = routedTransport([
      { match: '/token', handler: () => new Response('invalid_grant', { status: 400 }) },
      { match: 'userinfo', handler: () => jsonResponse({ email: 'still@works.com' }) },
    ])
    const material = await resolveAntigravitySystemCredential(
      { accessToken: 'ya29.stillvalid', refreshToken: '1//refresh' },
      { transport },
    )
    expect(material?.email).toBe('still@works.com')
    expect(material?.accessToken).toBe('ya29.stillvalid')
  })

  it('没有 refresh_token 时不发 /token 请求，直接查 userinfo', async () => {
    const { transport, calls } = routedTransport([
      { match: 'userinfo', handler: () => jsonResponse({ email: 'no-refresh@works.com' }) },
    ])
    const material = await resolveAntigravitySystemCredential({ accessToken: 'ya29.onlyaccess' }, { transport })
    expect(calls).toEqual([expect.stringContaining('userinfo')])
    expect(material?.email).toBe('no-refresh@works.com')
  })

  it('userinfo 拿不到邮箱（token 彻底失效）→ undefined，交给调用方 fallback', async () => {
    const { transport } = routedTransport([
      { match: '/token', handler: () => new Response('invalid_grant', { status: 400 }) },
      { match: 'userinfo', handler: () => new Response('unauthorized', { status: 401 }) },
    ])
    const material = await resolveAntigravitySystemCredential(
      { accessToken: 'ya29.dead', refreshToken: '1//dead' },
      { transport },
    )
    expect(material).toBeUndefined()
  })
})
