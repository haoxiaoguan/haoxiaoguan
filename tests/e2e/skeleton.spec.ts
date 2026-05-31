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
