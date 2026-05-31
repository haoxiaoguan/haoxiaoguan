import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'

// Smoke test for the walking skeleton. Proves the full toolchain end-to-end:
//  - Electron boots from the V8-bytecode main bundle (out/main/main.cjs),
//  - the renderer (React 19) mounts into #root,
//  - the preload contextBridge exposes window.api with the settings + system
//    namespaces (renderer -> preload -> ipcMain wiring is in place).
//
// NOTE: the production build loads the renderer via loadFile (file://). The
// source app uses BrowserRouter, which cannot match an absolute file path, so
// the routed view renders empty under a packaged load — hence we assert React
// mounted content (#root non-empty) rather than toBeVisible. Full routing under
// file:// (HashRouter) and the Settings/About nav assertion are deferred to the
// assembly plan (spec §8 step 13), per the "前端 UI 不动" constraint.

let app: ElectronApplication

test.afterEach(async () => {
  if (app) await app.close()
})

test('app launches from bytecode and exposes the preload bridge', async () => {
  app = await electron.launch({ args: ['out/main/main.cjs'] })
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
  app = await electron.launch({ args: ['out/main/main.cjs'] })
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

  // system:getAppDirs -> real OS paths
  const dirs = await window.evaluate(() =>
    (window as unknown as { api: { system: { getAppDirs(): Promise<{ dataDir: string }> } } }).api.system.getAppDirs(),
  )
  expect(dirs.dataDir).toContain('haoxiaoguan')

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
