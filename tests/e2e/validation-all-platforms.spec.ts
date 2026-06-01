import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Real-device proof that the top-right status badge is no longer 未支持 for any
// platform. The Rust source shipped only a stub validator, so every account
// (except none — even Kiro originally) reported state="unsupported", which the
// card renders as 未支持. We now register a generic TokenExpiryValidationCapability
// for every importable platform, so validation returns a real state.
//
// This scans whatever local credentials exist on THIS machine across all
// importable platforms, imports each, validates it, and asserts the state is
// never 'unsupported' (it must be valid/expired/etc — a real classification).
// Platforms with no local install simply contribute nothing; the test still
// passes as long as the ones present validate to a real state. Skipped only if
// NOTHING importable is found locally.

const IMPORTABLE = [
  'cursor',
  'windsurf',
  'antigravity',
  'kiro',
  'github_copilot',
  'codex',
  'gemini_cli',
  'codebuddy',
  'codebuddy_cn',
  'qoder',
  'trae',
  'zed',
] as const

interface ScannedMaterial {
  provider: string
  email: string
  access_token: string
  refresh_token?: string
  raw_metadata?: unknown
}

let app: ElectronApplication
let userDataDir: string

test.afterEach(async () => {
  if (app) await app.close()
  if (userDataDir) rmSync(userDataDir, { recursive: true, force: true })
})

test('every locally-importable platform validates to a real state (never 未支持)', async () => {
  userDataDir = mkdtempSync(join(tmpdir(), 'hxg-validate-all-'))
  app = await electron.launch({
    args: ['out/main/main.cjs'],
    env: { ...process.env, HXG_USER_DATA_DIR: userDataDir },
  })
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')

  const outcome = await window.evaluate(async (platforms: readonly string[]) => {
    const api = (window as unknown as {
      api: {
        credential: {
          scanLocalCredentials(p: string): Promise<ScannedMaterial[]>
          validateCredential(accountId: string): Promise<{ state: string }>
        }
        account: { importAccount(r: unknown): Promise<{ id: string }> }
      }
    }).api

    const results: Array<{ platform: string; state: string }> = []
    for (const platform of platforms) {
      let scanned: ScannedMaterial[] = []
      try {
        scanned = await api.credential.scanLocalCredentials(platform)
      } catch {
        continue // platform unsupported for local scan / not installed
      }
      if (scanned.length === 0) continue

      const m = scanned[0]
      const account = await api.account.importAccount({
        platform,
        email: m.email,
        token: m.access_token,
        refreshToken: m.refresh_token,
        rawMetadata: m.raw_metadata,
        tags: [],
      })
      const validation = await api.credential.validateCredential(account.id)
      results.push({ platform, state: validation.state })
    }
    return results
  }, IMPORTABLE as unknown as string[])

  test.skip(outcome.length === 0, 'no importable local credentials on this machine')

  // Every imported account must classify to a REAL state — never 'unsupported'.
  // A registered validator returns valid/expired/revoked/etc; 'unsupported' only
  // happens when no capability is registered (the bug we fixed).
  for (const { platform, state } of outcome) {
    expect(state, `${platform} validation state`).not.toBe('unsupported')
  }
})
