import { describe, it, expect } from 'vitest'
import { AntigravityOAuthCapability } from '../../../src/main/contexts/credential/infrastructure/capabilities/antigravity-oauth'
import { GeminiOAuthCapability } from '../../../src/main/contexts/credential/infrastructure/capabilities/gemini-oauth'
import { CodebuddyOAuthCapability } from '../../../src/main/contexts/credential/infrastructure/capabilities/codebuddy-oauth'
import { ZedOAuthCapability } from '../../../src/main/contexts/credential/infrastructure/capabilities/zed-oauth'
import { QoderOAuthCapability } from '../../../src/main/contexts/credential/infrastructure/capabilities/qoder-oauth'
import { WindsurfOAuthCapability } from '../../../src/main/contexts/credential/infrastructure/capabilities/windsurf-oauth'
import { TraeOAuthCapability } from '../../../src/main/contexts/credential/infrastructure/capabilities/trae-oauth'
import type { OAuthFetch } from '../../../src/main/contexts/credential/infrastructure/capabilities/oauth-http'
import { constants as cryptoConstants, publicEncrypt } from 'node:crypto'

function fakeJwt(payload: Record<string, unknown>): string {
  const enc = (obj: unknown): string => Buffer.from(JSON.stringify(obj)).toString('base64url')
  return `${enc({ alg: 'none' })}.${enc(payload)}.sig`
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// Routes a mock transport by URL substring so a single capability flow can be
// driven end-to-end without real network.
function routedTransport(routes: Array<{ match: string; handler: (url: string, init: RequestInit) => Response }>): {
  transport: OAuthFetch
  calls: Array<{ url: string; init: RequestInit }>
} {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const transport: OAuthFetch = async (url, init) => {
    calls.push({ url, init })
    const route = routes.find((r) => url.includes(r.match))
    if (!route) return new Response('not found', { status: 404 })
    return route.handler(url, init)
  }
  return { transport, calls }
}

function callbackPortFromAuthorizeUrl(authorizeUrl: string, param: string): number {
  const url = new URL(authorizeUrl)
  const redirect = url.searchParams.get(param)
  return redirect ? Number(new URL(redirect).port) : 0
}

describe('AntigravityOAuthCapability / GeminiOAuthCapability (Google loopback)', () => {
  it('rejects non-loopback modes', async () => {
    const cap = new AntigravityOAuthCapability()
    await expect(cap.startOAuth('deep_link')).rejects.toMatchObject({ kind: 'unsupported_source' })
  })

  it('antigravity: authorize URL carries Google params and completeOAuth normalises material', async () => {
    const idToken = fakeJwt({ email: 'a@example.com', sub: 'sub-1', name: 'Alice' })
    const { transport } = routedTransport([
      {
        match: '/token',
        handler: () =>
          jsonResponse({
            access_token: 'atk',
            refresh_token: 'rtk',
            id_token: idToken,
            expires_in: 3600,
            token_type: 'Bearer',
          }),
      },
      { match: 'userinfo', handler: () => jsonResponse({ id: 'gid-1', email: 'a@example.com', name: 'Alice' }) },
    ])
    const cap = new AntigravityOAuthCapability('antigravity', { transport })
    const pending = await cap.startOAuth('loopback_pkce')

    const url = new URL(pending.authorizeUrl)
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(url.searchParams.get('client_id')).toContain('apps.googleusercontent.com')
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('prompt')).toBe('consent')
    expect(url.searchParams.get('redirect_uri')).toBe(`http://localhost:${pending.boundPort}/oauth-callback`)

    const completion = cap.completeOAuth(pending.pendingId, '')
    await fetch(
      `http://127.0.0.1:${pending.boundPort}/oauth-callback?code=abc&state=${encodeURIComponent(pending.state)}`,
    )
    const material = await completion
    expect(material.provider).toBe('antigravity')
    expect(material.source).toBe('oauth')
    expect(material.email).toBe('a@example.com')
    expect(material.accessToken).toBe('atk')
    expect(material.refreshToken).toBe('rtk')
    const meta = material.rawMetadata as Record<string, unknown>
    expect(meta.selected_auth_type).toBe('google')
    expect((meta.antigravity_oauth_raw as Record<string, unknown>).refresh_token).toBe('rtk')
    expect(meta.auth_id).toBe('gid-1')
  })

  it('gemini: uses the gemini callback path and builds gemini_auth_raw', async () => {
    const { transport } = routedTransport([
      { match: '/token', handler: () => jsonResponse({ access_token: 'g-atk', refresh_token: 'g-rtk', expires_in: 3600 }) },
      { match: 'userinfo', handler: () => jsonResponse({ id: 'gg-1', email: 'g@example.com', name: 'Gem' }) },
    ])
    const cap = new GeminiOAuthCapability({ transport })
    const pending = await cap.startOAuth('loopback_pkce')
    expect(pending.redirectPath).toBe('/oauth2callback')

    const completion = cap.completeOAuth(pending.pendingId, '')
    await fetch(
      `http://127.0.0.1:${pending.boundPort}/oauth2callback?code=abc&state=${encodeURIComponent(pending.state)}`,
    )
    const material = await completion
    expect(material.provider).toBe('gemini_cli')
    expect(material.email).toBe('g@example.com')
    const meta = material.rawMetadata as Record<string, unknown>
    expect(meta.selected_auth_type).toBe('oauth-personal')
    expect((meta.gemini_auth_raw as Record<string, unknown>).access_token).toBe('g-atk')
  })
})

describe('CodebuddyOAuthCapability (server poll)', () => {
  it('polls auth/token then fetches the account and normalises material', async () => {
    let tokenPolls = 0
    const { transport } = routedTransport([
      { match: '/auth/state', handler: () => jsonResponse({ data: { state: 'st-1', authUrl: 'https://www.codebuddy.ai/login?state=st-1' } }) },
      {
        match: '/auth/token',
        handler: () => {
          tokenPolls += 1
          if (tokenPolls < 2) return jsonResponse({ code: 0, data: {} })
          return jsonResponse({
            code: 0,
            data: { accessToken: 'cb-atk', refreshToken: 'cb-rtk', domain: 'ent', expiresAt: 1893456000 },
          })
        },
      },
      { match: '/login/account', handler: () => jsonResponse({ data: { uid: 'u-1', nickname: 'Bud', email: 'bud@example.com', enterpriseId: 'e-1' } }) },
    ])
    const cap = new CodebuddyOAuthCapability('codebuddy', { transport })
    const pending = await cap.startOAuth('loopback_pkce')
    expect(pending.authorizeUrl).toContain('state=st-1')

    const material = await cap.completeOAuth(pending.pendingId, '')
    expect(material.provider).toBe('codebuddy')
    expect(material.email).toBe('bud@example.com')
    expect(material.accessToken).toBe('cb-atk')
    expect(material.refreshToken).toBe('cb-rtk')
    const meta = material.rawMetadata as Record<string, unknown>
    expect(meta.uid).toBe('u-1')
    expect(meta.enterprise_id).toBe('e-1')
    expect(meta.domain).toBe('ent')
  })

  it('codebuddy_cn defaults to the .cn base URL', async () => {
    const { transport, calls } = routedTransport([
      { match: '/auth/state', handler: () => jsonResponse({ data: { state: 'st-cn' } }) },
    ])
    const cap = new CodebuddyOAuthCapability('codebuddy_cn', { transport })
    const pending = await cap.startOAuth('loopback_pkce')
    expect(calls[0].url).toContain('https://www.codebuddy.cn')
    expect(pending.authorizeUrl).toContain('https://www.codebuddy.cn/login?state=st-cn')
  })
})

describe('ZedOAuthCapability (loopback + RSA)', () => {
  it('decrypts the RSA-OAEP callback token into material', async () => {
    const cap = new ZedOAuthCapability()
    const pending = await cap.startOAuth('loopback_pkce')
    const url = new URL(pending.authorizeUrl)
    expect(url.origin + url.pathname).toBe('https://zed.dev/native_app_signin')
    const publicKeyB64 = url.searchParams.get('native_app_public_key')!
    const port = Number(url.searchParams.get('native_app_port'))
    expect(port).toBe(pending.boundPort)

    // Encrypt a token with the advertised public key (PKCS1 DER, url-safe b64).
    const publicKeyDer = Buffer.from(publicKeyB64, 'base64url')
    const encrypted = publicEncrypt(
      { key: publicKeyDer, format: 'der', type: 'pkcs1', padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
      Buffer.from('zed-secret-token'),
    )
    const encryptedB64 = encrypted.toString('base64url')

    const completion = cap.completeOAuth(pending.pendingId, '')
    await fetch(`http://127.0.0.1:${port}/?user_id=zed-user-1&access_token=${encodeURIComponent(encryptedB64)}`)
    const material = await completion
    expect(material.provider).toBe('zed')
    expect(material.email).toBe('zed-user-1')
    expect(material.accessToken).toBe('zed-secret-token')
    const meta = material.rawMetadata as Record<string, unknown>
    expect(meta.user_id).toBe('zed-user-1')
  })
})

describe('QoderOAuthCapability (device poll + PKCE)', () => {
  it('builds a PKCE authorize URL and normalises poll + userinfo', async () => {
    let polls = 0
    const { transport } = routedTransport([
      {
        match: '/deviceToken/poll',
        handler: () => {
          polls += 1
          if (polls < 2) return new Response('', { status: 404 })
          return jsonResponse({ token: 'q-atk', user_id: 'q-1', refresh_token: 'q-rtk' })
        },
      },
      { match: '/api/v1/userinfo', handler: () => jsonResponse({ id: 'q-1', name: 'Qo', email: 'qo@example.com' }) },
      { match: '/api/v3/user/status', handler: () => jsonResponse({ id: 'q-1', whitelistStatus: 'PASS', quota: { used: 1 } }) },
    ])
    const cap = new QoderOAuthCapability({ transport })
    const pending = await cap.startOAuth('loopback_pkce')
    const url = new URL(pending.authorizeUrl)
    expect(url.searchParams.get('challenge_method')).toBe('S256')
    expect(url.searchParams.get('client_id')).toBe('e883ade2-e6e3-4d6d-adf7-f92ceff5fdcb')
    expect(url.searchParams.get('challenge')).toBeTruthy()

    const material = await cap.completeOAuth(pending.pendingId, '')
    expect(material.provider).toBe('qoder')
    expect(material.email).toBe('qo@example.com')
    expect(material.accessToken).toBe('q-atk')
    expect(material.refreshToken).toBe('q-rtk')
    const meta = material.rawMetadata as Record<string, unknown>
    expect(meta.user_id).toBe('q-1')
    expect(meta.display_name).toBe('Qo')
  })
})

describe('WindsurfOAuthCapability (Firebase implicit + RegisterUser)', () => {
  it('registers the firebase token then builds windsurf material', async () => {
    const firebaseToken = 'eyJmirebase'
    const { transport } = routedTransport([
      { match: 'RegisterUser', handler: () => jsonResponse({ apiKey: 'sk-ws-123', apiServerUrl: 'https://server.codeium.com', name: 'Wind' }) },
      { match: 'GetOneTimeAuthToken', handler: () => jsonResponse({ authToken: 'one-time' }) },
      { match: 'GetCurrentUser', handler: () => jsonResponse({ user: { id: 'w-1', email: 'wind@example.com', username: 'wind' } }) },
      { match: 'GetPlanStatus', handler: () => jsonResponse({ planInfo: { planName: 'pro' } }) },
      { match: 'GetUserStatus', handler: () => jsonResponse({ userStatus: { email: 'wind@example.com' } }) },
    ])
    const cap = new WindsurfOAuthCapability({ transport })
    const pending = await cap.startOAuth('loopback_pkce')
    const url = new URL(pending.authorizeUrl)
    expect(url.searchParams.get('response_type')).toBe('token')
    expect(url.searchParams.get('client_id')).toBe('3GUryQ7ldAeKEuD2obYnppsnmj58eP5u')

    const completion = cap.completeOAuth(pending.pendingId, '')
    await fetch(
      `http://127.0.0.1:${pending.boundPort}/windsurf-auth-callback?access_token=${firebaseToken}&state=${encodeURIComponent(pending.state)}`,
    )
    const material = await completion
    expect(material.provider).toBe('windsurf')
    expect(material.email).toBe('wind@example.com')
    expect(material.accessToken).toBe(firebaseToken)
    const meta = material.rawMetadata as Record<string, unknown>
    expect(meta.windsurf_api_key).toBe('sk-ws-123')
    expect(meta.github_login).toBe('wind')
    expect(meta.copilot_plan).toBe('pro')
  })

  it('fails when RegisterUser omits the apiKey', async () => {
    const { transport } = routedTransport([
      { match: 'RegisterUser', handler: () => jsonResponse({}) },
    ])
    const cap = new WindsurfOAuthCapability({ transport })
    const pending = await cap.startOAuth('loopback_pkce')
    const completion = cap.completeOAuth(pending.pendingId, '')
    const assertion = expect(completion).rejects.toThrow(/RegisterUser response missing apiKey/)
    await fetch(
      `http://127.0.0.1:${pending.boundPort}/windsurf-auth-callback?access_token=eyJx&state=${encodeURIComponent(pending.state)}`,
    )
    await assertion
  })
})

describe('TraeOAuthCapability (guidance + PKCE + exchange)', () => {
  it('runs guidance → authorize → authCode exchange → user info', async () => {
    const { transport } = routedTransport([
      { match: 'GetLoginGuidance', handler: () => jsonResponse({ Result: { LoginHost: 'https://www.trae.ai' } }) },
      { match: 'oauth/ExchangeToken', handler: () => jsonResponse({ Result: { AccessToken: 't-atk', RefreshToken: 't-rtk', ExpiresAt: 1893456000 } }) },
      { match: 'GetUserInfo', handler: () => jsonResponse({ Result: { UserID: 't-1', NonPlainTextEmail: 'trae@example.com', ScreenName: 'Tr' } }) },
    ])
    const cap = new TraeOAuthCapability({ transport })
    const pending = await cap.startOAuth('loopback_pkce')
    const url = new URL(pending.authorizeUrl)
    expect(url.origin + url.pathname).toBe('https://www.trae.ai/authorization')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('client_id')).toBe('ono9krqynydwx5')
    expect(callbackPortFromAuthorizeUrl(pending.authorizeUrl, 'auth_callback_url')).toBe(pending.boundPort)

    const completion = cap.completeOAuth(pending.pendingId, '')
    await fetch(`http://127.0.0.1:${pending.boundPort}/authorize?authCode=code-1&loginHost=${encodeURIComponent('https://www.trae.ai')}`)
    const material = await completion
    expect(material.provider).toBe('trae')
    expect(material.email).toBe('trae@example.com')
    expect(material.accessToken).toBe('t-atk')
    expect(material.refreshToken).toBe('t-rtk')
    const meta = material.rawMetadata as Record<string, unknown>
    expect(meta.user_id).toBe('t-1')
    expect(meta.nickname).toBe('Tr')
    const authRaw = meta.trae_auth_raw as Record<string, unknown>
    expect(authRaw.loginHost).toBe('https://www.trae.ai')
    expect(authRaw.deviceKeyPair).toBeDefined()
  })

  it('surfaces a guidance failure', async () => {
    const { transport } = routedTransport([
      { match: 'GetLoginGuidance', handler: () => new Response('nope', { status: 500 }) },
    ])
    const cap = new TraeOAuthCapability({ transport, guidanceUrls: ['https://api.trae.ai/x/GetLoginGuidance'] })
    await expect(cap.startOAuth('loopback_pkce')).rejects.toThrow(/GetLoginGuidance failed/)
  })
})
