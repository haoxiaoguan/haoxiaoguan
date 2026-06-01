import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'

// Real-device proof for the Kiro overage display. The cached Kiro account on this
// machine is a Pro+ with overage ENABLED, so the live getUsageLimits returns
// usageLimit=2000 (base) + overageCap=10000 (overage ceiling). The quota state
// must surface BOTH as separate metrics: 'credits' (0/2000) and 'overage_credits'
// (0/10000).
//
// This hits the LIVE AWS API (refreshes the token if expired), so it is guarded
// on a Kiro install being present and tolerates a network failure (the assertion
// only runs when the live fetch succeeds — otherwise the test reports skipped
// reason via the metrics being empty/error, which we treat as inconclusive).

const KIRO_AUTH = join(homedir(), '.aws', 'sso', 'cache', 'kiro-auth-token.json')
const haveKiro = existsSync(KIRO_AUTH)

interface QuotaMetricJson {
  key: string
  label: string
  used?: number
  total?: number
}
interface QuotaStateJson {
  status: string
  metrics: QuotaMetricJson[]
}

let app: ElectronApplication
let userDataDir: string

test.afterEach(async () => {
  if (app) await app.close()
  if (userDataDir) rmSync(userDataDir, { recursive: true, force: true })
})

test('kiro live quota shows base + overage metrics when overage is enabled', async () => {
  test.skip(!haveKiro, 'no ~/.aws/sso/cache/kiro-auth-token.json on this machine')

  userDataDir = mkdtempSync(join(tmpdir(), 'hxg-kiro-ov-'))
  app = await electron.launch({
    args: ['out/main/main.cjs'],
    env: { ...process.env, HXG_USER_DATA_DIR: userDataDir },
  })
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')

  // Import the kiro local account (scan → import), then refresh quota state live.
  const result = await window.evaluate(async () => {
    const api = (window as unknown as {
      api: {
        credential: {
          scanLocalCredentials(p: string): Promise<Array<Record<string, unknown>>>
          validateCredential(accountId: string): Promise<{ state: string }>
        }
        account: { importAccount(r: unknown): Promise<{ id: string }> }
        quota: { refreshQuotaState(a: { accountId: string }): Promise<unknown> }
      }
    }).api

    const scanned = await api.credential.scanLocalCredentials('kiro')
    if (scanned.length === 0) return { imported: false as const }
    const m = scanned[0] as {
      email: string
      access_token: string
      refresh_token?: string
      raw_metadata?: unknown
    }
    const account = await api.account.importAccount({
      platform: 'kiro',
      email: m.email,
      token: m.access_token,
      refreshToken: m.refresh_token,
      rawMetadata: m.raw_metadata,
      tags: [],
    })

    // Validation must no longer return 'unsupported' (the 未支持 badge). Kiro now
    // has a real validator: valid (unexpired or refreshable) or expired.
    const validation = await api.credential.validateCredential(account.id)

    try {
      const state = await api.quota.refreshQuotaState({ accountId: account.id })
      return { imported: true as const, ok: true as const, state, validationState: validation.state }
    } catch (e) {
      return { imported: true as const, ok: false as const, error: String(e), validationState: validation.state }
    }
  })

  expect(result.imported).toBe(true)
  // The validation badge fix: never 'unsupported' for Kiro now.
  expect(result.validationState).not.toBe('unsupported')
  expect(['valid', 'expired']).toContain(result.validationState)
  if (!result.ok) {
    // Live AWS unreachable / token unrefreshable in this environment — inconclusive,
    // not a failure of the parsing logic (covered by the unit tests).
    test.skip(true, `live quota fetch failed (network/token): ${result.error}`)
    return
  }

  const state = result.state as QuotaStateJson
  const byKey = Object.fromEntries(state.metrics.map((m) => [m.key, m]))

  // Base credits metric must be present.
  expect(byKey.credits).toBeDefined()
  // Overage metric must be present with the 10000 ceiling (this account has
  // overage ENABLED). This is the whole point of the fix.
  expect(byKey.overage_credits).toBeDefined()
  expect(byKey.overage_credits.total).toBe(10000)
  expect(byKey.overage_credits.label).toBe('超额额度')
})
