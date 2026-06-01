import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Smoke test for the walking skeleton. Proves the full toolchain end-to-end:
//  - Electron boots from the V8-bytecode main bundle (out/main/main.cjs),
//  - the renderer (React 19, HashRouter under file://) mounts into #root,
//  - the preload contextBridge exposes window.api, and IPC round-trips to the
//    real services + SQLite.
//
// Each test launches with an isolated HXG_USER_DATA_DIR so the single-instance
// SingletonLock and the SQLite DB do not collide across launches.

let app: ElectronApplication
let userDataDir: string | null = null

async function launchIsolated(): Promise<ElectronApplication> {
  userDataDir = mkdtempSync(join(tmpdir(), 'hxg-e2e-'))
  return electron.launch({
    args: ['out/main/main.cjs'],
    env: { ...process.env, HXG_USER_DATA_DIR: userDataDir },
  })
}

test.afterEach(async () => {
  if (app) await app.close()
  if (userDataDir) {
    rmSync(userDataDir, { recursive: true, force: true })
    userDataDir = null
  }
})

test('app launches from bytecode and exposes the preload bridge', async () => {
  app = await launchIsolated()
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')

  // window title comes from index.html
  expect(await window.title()).toBe('Haoxiaoguan')

  // React mounted content into #root
  const rootHtmlLength = await window.evaluate(
    () => document.getElementById('root')?.innerHTML.length ?? 0,
  )
  expect(rootHtmlLength).toBeGreaterThan(0)

  // preload contextBridge is wired: window.api.{settings,system} are present
  const apiShape = await window.evaluate(() => {
    const api = (window as unknown as { api?: Record<string, unknown> }).api
    return {
      hasApi: typeof api === 'object' && api !== null,
      hasSettings: typeof (api as { settings?: unknown })?.settings === 'object',
      hasSystem: typeof (api as { system?: unknown })?.system === 'object',
      hasGetVersion: typeof (api as { getVersion?: unknown })?.getVersion === 'function',
    }
  })
  expect(apiShape.hasApi).toBe(true)
  expect(apiShape.hasSettings).toBe(true)
  expect(apiShape.hasSystem).toBe(true)
  expect(apiShape.hasGetVersion).toBe(true)
})

test('IPC round-trips through the bridge to real services + DB', async () => {
  app = await launchIsolated()
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')

  // settings:getSettings -> SettingsApplicationService -> settings.json
  const settings = await window.evaluate(() =>
    (window as unknown as { api: { settings: { getSettings(): Promise<unknown> } } }).api.settings.getSettings(),
  )
  expect(settings).toMatchObject({
    theme: expect.any(String),
    language: expect.any(String),
    wsPort: expect.any(Number),
  })

  // settings round-trip: update then read back (proves write -> disk -> read)
  const updated = await window.evaluate(async () => {
    const api = (window as unknown as {
      api: { settings: { updateSettings(r: { settings: Record<string, string> }): Promise<void>; getSettings(): Promise<{ theme: string }> } }
    }).api
    await api.settings.updateSettings({ settings: { theme: 'dark' } })
    return (await api.settings.getSettings()).theme
  })
  expect(updated).toBe('dark')

  // system:getAppDirs -> real OS paths. appDataDir() honors HXG_USER_DATA_DIR,
  // so the reported dataDir must be the isolated temp dir this launch was given
  // (proves the DB/key/settings live in the isolated dir, not the real home).
  const dirs = await window.evaluate(() =>
    (window as unknown as { api: { system: { getAppDirs(): Promise<{ dataDir: string }> } } }).api.system.getAppDirs(),
  )
  expect(dirs.dataDir).toBe(userDataDir)

  // agent:listAgents -> the 17-adapter registry
  const agents = await window.evaluate(() =>
    (window as unknown as { api: { agent: { listAgents(): Promise<unknown[]> } } }).api.agent.listAgents(),
  )
  expect(Array.isArray(agents)).toBe(true)
  expect((agents as unknown[]).length).toBe(17)

  // account:getAccountsByPlatform -> MikroORM repo -> SQLite (proves DB schema
  // was created and a real query runs end-to-end; empty DB returns [])
  const accounts = await window.evaluate(() =>
    (window as unknown as { api: { account: { getAccountsByPlatform(p: string): Promise<unknown[]> } } }).api.account.getAccountsByPlatform('cursor'),
  )
  expect(Array.isArray(accounts)).toBe(true)

  // credential:validateBatch -> exercises the inline concurrency limiter that
  // replaced the pure-ESM p-limit (which threw "p_limit.default is not a
  // function" under the CJS bytecode bundle). Empty input must resolve to [].
  const batch = await window.evaluate(() =>
    (window as unknown as {
      api: { credential: { validateBatch(ids: string[], c?: number): Promise<unknown[]> } }
    }).api.credential.validateBatch([], 4),
  )
  expect(Array.isArray(batch)).toBe(true)

  // ws:getWsStatus + toggle -> the newly-wired websocket context (P0)
  const wsFlow = await window.evaluate(async () => {
    const api = (window as unknown as {
      api: { ws: { getWsStatus(): Promise<{ running: boolean }>; toggleWs(e: boolean): Promise<void> } }
    }).api
    const before = await api.ws.getWsStatus()
    await api.ws.toggleWs(true)
    const afterOn = await api.ws.getWsStatus()
    await api.ws.toggleWs(false)
    const afterOff = await api.ws.getWsStatus()
    return { before: before.running, afterOn: afterOn.running, afterOff: afterOff.running }
  })
  expect(wsFlow.before).toBe(false)
  expect(wsFlow.afterOn).toBe(true)
  expect(wsFlow.afterOff).toBe(false)
})

test('heavy usage sync does not block the event loop (no UI freeze)', async () => {
  app = await launchIsolated()
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')

  // Kick off the heavy session-log scan (walks ~/.claude, ~/.codex, etc. —
  // thousands of files). Concurrently fire a cheap IPC ping on a short interval;
  // if the scan blocks the main event loop the pings stall. We assert several
  // pings complete promptly WHILE the sync is still in flight.
  const result = await window.evaluate(async () => {
    const api = (window as unknown as {
      api: {
        usage: { syncUsageSources(): Promise<unknown> }
        system: { getAppDirs(): Promise<unknown> }
      }
    }).api

    let pings = 0
    let blocked = false
    const start = Date.now()
    const pinger = setInterval(() => {
      const t = Date.now()
      void api.system.getAppDirs().then(() => {
        // A responsive main process answers getAppDirs in well under 500ms.
        if (Date.now() - t > 1500) blocked = true
        pings++
      })
    }, 100)

    // Run the heavy scan; do not let a rejection fail the test (data-dependent).
    await api.usage.syncUsageSources().catch(() => undefined)
    // Give a couple more ping cycles a chance to land.
    await new Promise((r) => setTimeout(r, 400))
    clearInterval(pinger)
    return { pings, blocked, elapsed: Date.now() - start }
  })

  // The pinger fires every 100ms; if the loop were blocked for the whole scan we
  // would see ~0 completed pings. Require several to have completed responsively.
  expect(result.pings).toBeGreaterThanOrEqual(3)
  expect(result.blocked).toBe(false)
})
