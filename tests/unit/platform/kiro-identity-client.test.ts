import { describe, it, expect } from 'vitest'
import {
  KiroAuthError,
  KIRO_BUILDER_ID_PROFILE_ARN,
  KIRO_SOCIAL_PROFILE_ARN,
  defaultProfileArnFor,
  fetchKiroUsageLimits,
  parseRegionFromArn,
  refreshKiroToken,
  resolveKiroAuthMethod,
  runtimeEndpointForRegion,
} from '../../../src/main/platform/net/kiro/kiro-identity-client'

// A fake fetch capturing the last request and returning a scripted response.
function fakeFetch(status: number, body: unknown) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const impl = async (url: string, init: RequestInit): Promise<Response> => {
    calls.push({ url, init })
    const text = typeof body === 'string' ? body : JSON.stringify(body)
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => text,
    } as Response
  }
  return { impl, calls }
}

function headersOf(init: RequestInit): Record<string, string> {
  return (init.headers ?? {}) as Record<string, string>
}

describe('resolveKiroAuthMethod', () => {
  it('classifies explicit IdC / social / api_key', () => {
    expect(resolveKiroAuthMethod({ auth_method: 'IdC' })).toBe('idc')
    expect(resolveKiroAuthMethod({ authMethod: 'social' })).toBe('social')
    expect(resolveKiroAuthMethod({ auth_method: 'api_key' })).toBe('api_key')
  })

  it('infers idc from clientId+clientSecret, social otherwise', () => {
    expect(resolveKiroAuthMethod({ client_id: 'a', client_secret: 'b' })).toBe('idc')
    expect(resolveKiroAuthMethod({ refreshToken: 'r' })).toBe('social')
    expect(resolveKiroAuthMethod({ kiroApiKey: 'k' })).toBe('api_key')
  })

  it('honors the reference provider field (Github/Google→social, BuilderId/Enterprise→idc)', () => {
    expect(resolveKiroAuthMethod({ provider: 'Github', refreshToken: 'r' })).toBe('social')
    expect(resolveKiroAuthMethod({ provider: 'Google', refreshToken: 'r' })).toBe('social')
    expect(resolveKiroAuthMethod({ provider: 'BuilderId', client_id: 'a', client_secret: 'b' })).toBe('idc')
    expect(resolveKiroAuthMethod({ provider: 'Enterprise', client_id: 'a', client_secret: 'b' })).toBe('idc')
  })
})

describe('parseRegionFromArn', () => {
  it('extracts the 4th ARN segment', () => {
    expect(parseRegionFromArn('arn:aws:codewhisperer:eu-central-1:123:profile/X')).toBe('eu-central-1')
    expect(parseRegionFromArn('not-an-arn')).toBeUndefined()
    expect(parseRegionFromArn(undefined)).toBeUndefined()
  })
})

describe('runtimeEndpointForRegion', () => {
  it('maps known regions and falls back to us-east-1', () => {
    expect(runtimeEndpointForRegion('us-east-1')).toBe('https://q.us-east-1.amazonaws.com')
    expect(runtimeEndpointForRegion('eu-central-1')).toBe('https://q.eu-central-1.amazonaws.com')
    expect(runtimeEndpointForRegion('made-up')).toBe('https://q.us-east-1.amazonaws.com')
  })
})

describe('refreshKiroToken (IdC)', () => {
  it('posts to AWS SSO OIDC with camelCase body + sso-oidc headers', async () => {
    const f = fakeFetch(200, { accessToken: 'new-access', refreshToken: 'new-refresh', expiresIn: 3600 })
    const out = await refreshKiroToken(
      { kind: 'idc', clientId: 'cid', clientSecret: 'csec', refreshToken: 'rt', region: 'us-east-1' },
      { fetchImpl: f.impl },
    )
    expect(out.accessToken).toBe('new-access')
    expect(out.refreshToken).toBe('new-refresh')
    expect(out.expiresAt).toBeInstanceOf(Date)

    const { url, init } = f.calls[0]
    expect(url).toBe('https://oidc.us-east-1.amazonaws.com/token')
    expect(JSON.parse(init.body as string)).toEqual({
      clientId: 'cid',
      clientSecret: 'csec',
      refreshToken: 'rt',
      grantType: 'refresh_token',
    })
    const h = headersOf(init)
    expect(h['x-amz-user-agent']).toContain('aws-sdk-js/3.980.0 KiroIDE')
    expect(h['user-agent']).toContain('api/sso-oidc#3.980.0')
    expect(h['amz-sdk-request']).toBe('attempt=1; max=4')
  })

  it('throws a permanent KiroAuthError on 400 invalid_grant', async () => {
    const f = fakeFetch(400, { error: 'invalid_grant', message: 'Invalid refresh token provided' })
    await expect(
      refreshKiroToken(
        { kind: 'idc', clientId: 'c', clientSecret: 's', refreshToken: 'rt', region: 'us-east-1' },
        { fetchImpl: f.impl },
      ),
    ).rejects.toSatisfy((e: unknown) => e instanceof KiroAuthError && e.permanent && e.code === 'invalid_grant')
  })
})

describe('refreshKiroToken (Social)', () => {
  it('posts to the desktop auth endpoint with the KiroIDE UA', async () => {
    const f = fakeFetch(200, { data: { accessToken: 'a', refreshToken: 'b' } })
    const out = await refreshKiroToken(
      { kind: 'social', refreshToken: 'rt', region: 'us-east-1' },
      { fetchImpl: f.impl },
    )
    expect(out.accessToken).toBe('a')
    const { url, init } = f.calls[0]
    expect(url).toBe('https://prod.us-east-1.auth.desktop.kiro.dev/refreshToken')
    expect(JSON.parse(init.body as string)).toEqual({ refreshToken: 'rt' })
    expect(headersOf(init)['User-Agent']).toMatch(/^KiroIDE-0\.11\.107-/)
  })
})

describe('fetchKiroUsageLimits', () => {
  it('GETs getUsageLimits with the profileArn query + Bearer auth', async () => {
    const f = fakeFetch(200, { userInfo: { email: 'e@x.com' } })
    const out = (await fetchKiroUsageLimits(
      { accessToken: 'tok', authMethod: 'idc', region: 'us-east-1', profileArn: 'arn:aws:codewhisperer:us-east-1:1:profile/X' },
      { fetchImpl: f.impl },
    )) as { userInfo: { email: string } }
    expect(out.userInfo.email).toBe('e@x.com')
    const { url, init } = f.calls[0]
    expect(url).toContain('https://q.us-east-1.amazonaws.com/getUsageLimits?')
    expect(url).toContain('origin=AI_EDITOR')
    expect(url).toContain('resourceType=AGENTIC_REQUEST')
    expect(url).toContain('profileArn=arn%3Aaws%3Acodewhisperer')
    const h = headersOf(init)
    expect(h.Authorization).toBe('Bearer tok')
    expect(h['user-agent']).toContain('api/codewhispererruntime#1.0.34')
    expect(h['user-agent']).toContain('m/E')
    expect(h['user-agent']).not.toContain('m/N')
    expect(h.tokentype).toBeUndefined()
  })

  it('adds tokentype: API_KEY for api_key accounts', async () => {
    const f = fakeFetch(200, {})
    await fetchKiroUsageLimits(
      { accessToken: 'tok', authMethod: 'api_key', region: 'us-east-1' },
      { fetchImpl: f.impl },
    )
    expect(headersOf(f.calls[0].init).tokentype).toBe('API_KEY')
  })

  it('falls back to the social default profileArn when none is provided (social)', async () => {
    const f = fakeFetch(200, {})
    await fetchKiroUsageLimits(
      { accessToken: 'tok', authMethod: 'social', region: 'us-east-1' },
      { fetchImpl: f.impl },
    )
    // 699475941385/.../EHGA3GRVQMUK is the well-known social profile.
    expect(f.calls[0].url).toContain('profileArn=arn%3Aaws%3Acodewhisperer')
    expect(decodeURIComponent(f.calls[0].url)).toContain('699475941385:profile/EHGA3GRVQMUK')
  })

  it('falls back to the Builder-ID default profileArn for idc when none is provided', async () => {
    const f = fakeFetch(200, {})
    await fetchKiroUsageLimits(
      { accessToken: 'tok', authMethod: 'idc', region: 'us-east-1' },
      { fetchImpl: f.impl },
    )
    expect(decodeURIComponent(f.calls[0].url)).toContain('638616132270:profile/AAAACCCCXXXX')
  })
})

describe('defaultProfileArnFor', () => {
  it('maps social→social profile, idc/api_key→builder-id profile', () => {
    expect(defaultProfileArnFor('social')).toBe(KIRO_SOCIAL_PROFILE_ARN)
    expect(defaultProfileArnFor('idc')).toBe(KIRO_BUILDER_ID_PROFILE_ARN)
    expect(defaultProfileArnFor('api_key')).toBe(KIRO_BUILDER_ID_PROFILE_ARN)
  })
})
