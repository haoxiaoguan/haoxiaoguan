import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'

// Regression proof for the "同步时间" (sync time) bug:
//   After importing an account, clicking Refresh did NOT change the displayed
//   sync time — it stayed at the import time.
//
// Root cause was purely in the renderer: the 同步时间 column read
// `account.lastUsedAt || account.createdAt`, but lastUsedAt is only bumped on
// account activation/switch, never on a quota refresh. A quota refresh updates
// the quota STATE's `fetchedAt` instead. The column now reads
// `quotaState.fetchedAt` first (falling back to lastUsedAt || createdAt).
//
// This test proves the value the column reads actually advances on refresh:
// it captures fetchedAt after the first refresh, waits past one clock second,
// refreshes again, and asserts the second fetchedAt is strictly newer. Hits the
// LIVE AWS API, so it is guarded on a Kiro install and tolerates network failure.

const KIRO_AUTH = join(homedir(), '.aws', 'sso', 'cache', 'kiro-auth-token.json')
const haveKiro = existsSync(KIRO_AUTH)

interface QuotaStateJson {
  status: string
  fetchedAt?: string
}

let app: ElectronApplication
let userDataDir: string

test.afterEach(async () => {
  if (app) await app.close()
  if (userDataDir) rmSync(userDataDir, { recursive: true, force: true })
})

test('refreshing quota advances the fetchedAt the 同步时间 column reads', async () => {
  test.skip(!haveKiro, 'no ~/.aws/sso/cache/kiro-auth-token.json on this machine')

  userDataDir = mkdtempSync(join(tmpdir(), 'hxg-synctime-'))
  app = await electron.launch({
    args: ['out/main/main.cjs'],
    env: { ...process.env, HXG_USER_DATA_DIR: userDataDir },
  })
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')

  const result = await window.evaluate(async () => {
    const api = (window as unknown as {
      api: {
        credential: { scanLocalCredentials(p: string): Promise<Array<Record<string, unknown>>> }
        account: { importAccount(r: unknown): Promise<{ id: string }> }
        quota: { refreshQuotaState(a: { accountId: string }): Promise<{ fetchedAt?: string }> }
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

    try {
      const first = await api.quota.refreshQuotaState({ accountId: account.id })
      // Ensure the wall clock advances at least one whole second between fetches,
      // so two distinct RFC3339 timestamps are guaranteed even at 1s resolution.
      await new Promise((r) => setTimeout(r, 1100))
      const second = await api.quota.refreshQuotaState({ accountId: account.id })
      return {
        imported: true as const,
        ok: true as const,
        first: first.fetchedAt ?? null,
        second: second.fetchedAt ?? null,
      }
    } catch (e) {
      return { imported: true as const, ok: false as const, error: String(e) }
    }
  })

  expect(result.imported).toBe(true)
  if (!result.ok) {
    test.skip(true, `live quota fetch failed (network/token): ${result.error}`)
    return
  }

  // Both refreshes must stamp a fetchedAt, and the second must be strictly newer.
  expect(result.first).toBeTruthy()
  expect(result.second).toBeTruthy()
  const t1 = new Date(result.first as string).getTime()
  const t2 = new Date(result.second as string).getTime()
  expect(Number.isNaN(t1)).toBe(false)
  expect(Number.isNaN(t2)).toBe(false)
  expect(t2).toBeGreaterThan(t1)
})
