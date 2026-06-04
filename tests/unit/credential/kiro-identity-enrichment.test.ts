import { describe, it, expect } from 'vitest'
import { enrichKiroMaterial } from '../../../src/main/contexts/credential/infrastructure/capabilities/kiro-identity-enrichment'
import type { ImportedCredentialMaterial } from '../../../src/main/contexts/credential/domain/capability-types'
import { profileFromImportMaterial } from '../../../src/main/contexts/account/domain/platform-profile'
import { sanitizeProviderPayload } from '../../../src/main/contexts/account/domain/platform-profile/helpers'
import type { JsonValue } from '../../../src/main/contexts/account/domain/platform-account-profile'

// Scripted fetch keyed by URL substring → { status, body }.
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

function baseMaterial(overrides: Partial<ImportedCredentialMaterial> = {}): ImportedCredentialMaterial {
  return {
    provider: 'kiro',
    email: 'kiro-user',
    accessToken: 'opaque-access',
    refreshToken: 'opaque-refresh',
    source: 'local_scan',
    rawMetadata: {
      auth_method: 'IdC',
      region: 'us-east-1',
      client_id: 'cid',
      client_secret: 'csecret',
      profileArn: 'arn:aws:codewhisperer:us-east-1:607416644019:profile/X',
      // A STALE local profile (previous account) that would poison derivation.
      kiro_profile_raw: { arn: 'arn:aws:codewhisperer:us-east-1:607416644019:profile/X', name: 'stale' },
      kiro_usage_raw: {
        userInfo: { email: 'galardo@example.com', userId: 'd-OLD.stale' },
        subscriptionInfo: { subscriptionTitle: 'KIRO FREE' },
      },
    },
    ...overrides,
  }
}

const LIVE_USAGE = {
  userInfo: { email: 'wash.in.at.te+5hv4@example.com', userId: 'd-90660ceab3.current' },
  subscriptionInfo: { subscriptionTitle: 'KIRO POWER' },
}

describe('enrichKiroMaterial', () => {
  it('injects live identity and voids the stale profile', async () => {
    const f = scriptedFetch([{ match: '/getUsageLimits', status: 200, body: LIVE_USAGE }])
    const out = await enrichKiroMaterial(baseMaterial(), { fetchImpl: f.impl })
    const meta = out.rawMetadata as Record<string, JsonValue>
    expect(out.email).toBe('wash.in.at.te+5hv4@example.com')
    expect(meta.identity_source).toBe('live')
    expect(meta.kiro_profile_raw).toBeNull() // poison voided
    expect(meta.user_id).toBe('d-90660ceab3.current')
    expect((meta.kiro_usage_raw as Record<string, unknown>).subscriptionInfo).toEqual({
      subscriptionTitle: 'KIRO POWER',
    })
  })

  it('derives the correct identity + plan downstream (anti-poison)', async () => {
    const f = scriptedFetch([{ match: '/getUsageLimits', status: 200, body: LIVE_USAGE }])
    const out = await enrichKiroMaterial(baseMaterial(), { fetchImpl: f.impl })
    const profile = profileFromImportMaterial('kiro', out.email, out.rawMetadata, out.accessToken)
    // Live identity wins over the stale d-OLD; plan is the live KIRO POWER.
    // identityKey 取稳定 userId；displayIdentifier 取可读 email（两者解耦）。
    expect(profile.identityKey).toBe('d-90660ceab3.current')
    expect(profile.displayIdentifier).toBe('wash.in.at.te+5hv4@example.com')
    expect(profile.planName).toBe('KIRO POWER')
    expect(profile.identityKey).not.toContain('OLD')
    expect(profile.displayIdentifier).not.toContain('OLD')
  })

  it('refreshes once on 401 then retries, writing the new token back', async () => {
    let usageCalls = 0
    const impl = async (url: string): Promise<Response> => {
      if (url.includes('/token')) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ accessToken: 'fresh-access', refreshToken: 'fresh-refresh', expiresIn: 3600 }) } as Response
      }
      if (url.includes('/getUsageLimits')) {
        usageCalls += 1
        if (usageCalls === 1) return { ok: false, status: 401, text: async () => 'expired' } as Response
        return { ok: true, status: 200, text: async () => JSON.stringify(LIVE_USAGE) } as Response
      }
      throw new Error(`no route ${url}`)
    }
    const out = await enrichKiroMaterial(baseMaterial(), { fetchImpl: impl })
    expect(out.accessToken).toBe('fresh-access')
    expect(out.refreshToken).toBe('fresh-refresh')
    expect((out.rawMetadata as Record<string, unknown>).identity_source).toBe('live')
    expect(usageCalls).toBe(2)
  })

  it('aborts (throws) on failure when allowStale is false', async () => {
    const impl = async (): Promise<Response> => {
      throw new Error('offline')
    }
    await expect(enrichKiroMaterial(baseMaterial(), { fetchImpl: impl })).rejects.toMatchObject({
      kind: 'provider_error',
    })
  })

  it('degrades to a placeholder (voiding stale profile) when allowStale is true', async () => {
    const impl = async (): Promise<Response> => {
      throw new Error('offline')
    }
    const out = await enrichKiroMaterial(baseMaterial(), { allowStale: true, fetchImpl: impl })
    const meta = out.rawMetadata as Record<string, JsonValue>
    expect(meta.identity_source).toBe('local_stale')
    expect(meta.kiro_profile_raw).toBeNull() // never keep the stale identity
    expect(typeof meta.identity_enrichment_error).toBe('string')
    // Downstream derivation must NOT yield the stale galardo identity.
    const profile = profileFromImportMaterial('kiro', out.email, out.rawMetadata, out.accessToken)
    expect(profile.displayIdentifier).not.toContain('OLD')
  })

  it('keeps clientSecret out of the plaintext profilePayload but in raw metadata', async () => {
    const f = scriptedFetch([{ match: '/getUsageLimits', status: 200, body: LIVE_USAGE }])
    const out = await enrichKiroMaterial(baseMaterial(), { fetchImpl: f.impl })
    // The enriched rawMetadata (stored in the ENCRYPTED credential) retains it.
    expect((out.rawMetadata as Record<string, unknown>).client_secret).toBe('csecret')
    // The derived profilePayload (stored PLAINTEXT in accounts) must not.
    const profile = profileFromImportMaterial('kiro', out.email, out.rawMetadata, out.accessToken)
    const payload = profile.profilePayload as Record<string, unknown>
    expect(payload.client_secret).toBeUndefined()
    expect(payload.clientSecret).toBeUndefined()
    // Direct sanitize check for both casings.
    const sanitized = sanitizeProviderPayload({ client_secret: 'x', clientSecret: 'y', keep: 'z' }) as Record<string, unknown>
    expect(sanitized.client_secret).toBeUndefined()
    expect(sanitized.clientSecret).toBeUndefined()
    expect(sanitized.keep).toBe('z')
  })
})
