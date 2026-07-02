import { describe, it, expect, afterEach, vi } from 'vitest'
import { Credential } from '../../../../src/main/contexts/account/domain/credential'
import { fetch as fetchAntigravityQuota } from '../../../../src/main/contexts/quota/infrastructure/http/antigravity'

// retrieveUserQuotaSummary (unlike loadCodeAssist) 403s as PERMISSION_DENIED for
// any request missing a recognisable User-Agent — regardless of whether the
// account is actually fine or actually banned. Verified against a real,
// working account: same access_token, same everything else, only difference
// was the User-Agent header, and it flipped a working account from "banned"
// to a correct quota read. These tests lock in the fix (headers sent) and the
// still-correct behaviour when Google genuinely does return that error shape.

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function nonExpiredCredential(): Credential {
  return new Credential('ya29.access', '1//refresh', new Date(Date.now() + 3_600_000), {})
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('antigravity quota fetch', () => {
  it('sends an Antigravity-identifying User-Agent + x-goog-api-client on every CloudCode call', async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = []
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const headers: Record<string, string> = {}
      new Headers(init?.headers).forEach((v, k) => { headers[k] = v })
      calls.push({ url: url.toString(), headers })
      if (url.toString().includes('loadCodeAssist')) {
        return jsonResponse({
          currentTier: { id: 'free-tier', name: 'Antigravity' },
          cloudaicompanionProject: 'meta-scout-8tr8c',
        })
      }
      if (url.toString().includes('userinfo')) {
        return jsonResponse({ id: 'uid-1', email: 'a876771120@gmail.com', name: '刘勤' })
      }
      if (url.toString().includes('retrieveUserQuotaSummary')) {
        return jsonResponse({
          groups: [
            {
              displayName: 'Gemini Models',
              buckets: [{ bucketId: 'gemini-weekly', displayName: 'Weekly Limit', remainingFraction: 0.96 }],
            },
          ],
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchAntigravityQuota(nonExpiredCredential(), {})

    expect(result.outcome).toBe('success')
    expect(result.models.length).toBeGreaterThan(0)

    const cloudCodeCalls = calls.filter((c) => c.url.includes('cloudcode-pa.googleapis.com'))
    expect(cloudCodeCalls.length).toBeGreaterThanOrEqual(2)
    for (const call of cloudCodeCalls) {
      expect(call.headers['user-agent']).toMatch(/^antigravity\/.+ google-api-nodejs-client\/.+/)
      expect(call.headers['x-goog-api-client']).toMatch(/^gl-node\//)
    }
  })

  it('仍然能正确识别 Google 真的返回 PERMISSION_DENIED 的情况（不会被这次修复悄悄吞掉）', async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      if (url.toString().includes('loadCodeAssist')) {
        return jsonResponse({ currentTier: { id: 'free-tier' }, cloudaicompanionProject: 'proj-1' })
      }
      if (url.toString().includes('userinfo')) {
        return jsonResponse({ id: 'uid-1', email: 'a@example.com' })
      }
      if (url.toString().includes('retrieveUserQuotaSummary')) {
        return jsonResponse(
          { error: { code: 403, message: 'The caller does not have permission', status: 'PERMISSION_DENIED' } },
          403,
        )
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchAntigravityQuota(nonExpiredCredential(), {})).rejects.toThrow(/已被 Google 禁用/)
  })
})
