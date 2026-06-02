import { describe, it, expect } from 'vitest'
import { KiroTokenJsonImportCapability } from '../../../src/main/contexts/credential/infrastructure/capabilities/kiro-token-json-import'
import { profileFromImportMaterial } from '../../../src/main/contexts/account/domain/platform-profile'
import type { JsonValue } from '../../../src/main/contexts/account/domain/platform-account-profile'

// The Kiro token-JSON capability = generic parse + online identity enrichment.
// These drive the SAME path the paste-JSON import UI uses (importFromJson),
// injecting a scripted fetch so no real network is touched.

function scriptedFetch(routes: Array<{ match: string; status: number; body: unknown }>) {
  const calls: string[] = []
  const impl = async (url: string): Promise<Response> => {
    calls.push(url)
    const route = routes.find((r) => url.includes(r.match))
    if (route === undefined) throw new Error(`no route for ${url}`)
    const text = typeof route.body === 'string' ? route.body : JSON.stringify(route.body)
    return { ok: route.status >= 200 && route.status < 300, status: route.status, text: async () => text } as Response
  }
  return { impl, calls }
}

// The user's real payload shape: opaque (non-JWT) tokens + IdC clientId/clientSecret.
const PAYLOAD = JSON.stringify({
  accessToken: 'aoaOPAQUE-not-a-jwt:MGUC-sig',
  refreshToken: 'aorOPAQUE-not-a-jwt:MGUC-sig',
  clientId: 'XeC64GwkpAJa8fGhuhhxIHVzLWVhc3QtMQ',
  clientSecret: 'eyJraWQiOiJrIn0.eyJzZXJpYWxpemVkIjoiYWJjIn0.sig',
})

const LIVE_USAGE = {
  userInfo: { email: 'wash.in.at.te+5hv4@example.com', userId: 'd-90660ceab3.current' },
  subscriptionInfo: { subscriptionTitle: 'KIRO POWER' },
}

describe('KiroTokenJsonImportCapability', () => {
  it('provider() is kiro', () => {
    expect(new KiroTokenJsonImportCapability().provider()).toBe('kiro')
  })

  it('confirms identity online and derives the live identity + plan (IdC)', async () => {
    const f = scriptedFetch([{ match: '/getUsageLimits', status: 200, body: LIVE_USAGE }])
    const cap = new KiroTokenJsonImportCapability(false, f.impl)
    const material = await cap.importFromJson(PAYLOAD)

    expect(material.email).toBe('wash.in.at.te+5hv4@example.com')
    const meta = material.rawMetadata as Record<string, JsonValue>
    expect(meta.identity_source).toBe('live')

    // The opaque token would otherwise yield a placeholder; live identity wins.
    const profile = profileFromImportMaterial('kiro', material.email, material.rawMetadata, material.accessToken)
    expect(profile.displayIdentifier).toBe('d-90660ceab3.current')
    expect(profile.identityKey).toBe('d-90660ceab3.current')
    expect(profile.planName).toBe('KIRO POWER')
  })

  it('keeps clientSecret in encrypted rawMetadata but out of the plaintext profilePayload', async () => {
    const f = scriptedFetch([{ match: '/getUsageLimits', status: 200, body: LIVE_USAGE }])
    const cap = new KiroTokenJsonImportCapability(false, f.impl)
    const material = await cap.importFromJson(PAYLOAD)

    expect((material.rawMetadata as Record<string, unknown>).clientSecret).toBe(
      'eyJraWQiOiJrIn0.eyJzZXJpYWxpemVkIjoiYWJjIn0.sig',
    )
    const profile = profileFromImportMaterial('kiro', material.email, material.rawMetadata, material.accessToken)
    const payload = profile.profilePayload as Record<string, unknown>
    expect(payload.clientSecret).toBeUndefined()
    expect(payload.client_secret).toBeUndefined()
  })

  it('aborts with a clear error when identity cannot be confirmed (allowStale=false)', async () => {
    const impl = async (): Promise<Response> => { throw new Error('offline') }
    const cap = new KiroTokenJsonImportCapability(false, impl)
    await expect(cap.importFromJson(PAYLOAD)).rejects.toMatchObject({
      kind: 'provider_error',
      data: { code: 'kiro_identity_unconfirmed' },
    })
  })

  it('degrades to a placeholder identity when allowStale=true (resolver form)', async () => {
    const impl = async (): Promise<Response> => { throw new Error('offline') }
    const cap = new KiroTokenJsonImportCapability(() => true, impl)
    const material = await cap.importFromJson(PAYLOAD)
    expect(material.email).toBe('kiro-user')
    const meta = material.rawMetadata as Record<string, JsonValue>
    expect(meta.identity_source).toBe('local_stale')
    expect(meta.kiro_profile_raw).toBeNull()
  })

  it('accepts a refreshToken-only paste (reference format) by refreshing first', async () => {
    // No accessToken in the payload — the reference's canonical IdC shape.
    // Must refresh up-front (clientId/clientSecret/refreshToken), then confirm.
    const refreshOnly = JSON.stringify({
      refreshToken: 'aorOPAQUE:MGUC-sig',
      clientId: 'XeC64GwkpAJa8fGhuhhxIHVzLWVhc3QtMQ',
      clientSecret: 'eyJ.eyJ.sig',
      region: 'us-east-1',
    })
    let tokenCalls = 0
    const impl = async (url: string): Promise<Response> => {
      if (url.includes('/token')) {
        tokenCalls += 1
        return { ok: true, status: 200, text: async () => JSON.stringify({ accessToken: 'FRESH', refreshToken: 'FRESH-R', expiresIn: 3600 }) } as Response
      }
      if (url.includes('/getUsageLimits')) {
        return { ok: true, status: 200, text: async () => JSON.stringify(LIVE_USAGE) } as Response
      }
      throw new Error(`no route ${url}`)
    }
    const cap = new KiroTokenJsonImportCapability(false, impl)
    const material = await cap.importFromJson(refreshOnly)

    expect(tokenCalls).toBe(1) // refreshed up-front
    expect(material.accessToken).toBe('FRESH')
    expect(material.email).toBe('wash.in.at.te+5hv4@example.com')
    const profile = profileFromImportMaterial('kiro', material.email, material.rawMetadata, material.accessToken)
    expect(profile.identityKey).toBe('d-90660ceab3.current')
    expect(profile.planName).toBe('KIRO POWER')
  })

  it('routes a social paste (provider=Github, no clientSecret) to the social refresh', async () => {
    const social = JSON.stringify({ refreshToken: 'social-refresh', provider: 'Github' })
    const seen: string[] = []
    const impl = async (url: string): Promise<Response> => {
      seen.push(url)
      if (url.includes('/refreshToken')) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ accessToken: 'SOCIAL-FRESH', expiresIn: 3600 }) } as Response
      }
      if (url.includes('/getUsageLimits')) {
        return { ok: true, status: 200, text: async () => JSON.stringify(LIVE_USAGE) } as Response
      }
      throw new Error(`no route ${url}`)
    }
    const cap = new KiroTokenJsonImportCapability(false, impl)
    const material = await cap.importFromJson(social)
    expect(material.accessToken).toBe('SOCIAL-FRESH')
    // provider=Github → social endpoint, not the IdC oidc /token.
    expect(seen.some((u) => u.includes('/refreshToken'))).toBe(true)
    expect(seen.some((u) => u.includes('oidc.'))).toBe(false)
  })
})
