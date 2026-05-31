import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Diagnostic: launch the built app, capture renderer console + page errors, and
// walk the main routes by driving the hash/history so we can see WHICH page (if
// any) throws at runtime. Surfaces the real cause of a UI freeze that the
// happy-path smoke test does not.

let app: ElectronApplication
let userDataDir: string | null = null

test.afterEach(async () => {
  if (app) await app.close()
  if (userDataDir) {
    rmSync(userDataDir, { recursive: true, force: true })
    userDataDir = null
  }
})

test('capture renderer errors across routes', async () => {
  userDataDir = mkdtempSync(join(tmpdir(), 'hxg-e2e-'))
  app = await electron.launch({
    args: ['out/main/main.cjs'],
    env: { ...process.env, HXG_USER_DATA_DIR: userDataDir },
  })
  const window = await app.firstWindow()

  const errors: string[] = []
  const consoleErrors: string[] = []
  window.on('pageerror', (e) => errors.push(`${e.name}: ${e.message}`))
  window.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })

  await window.waitForLoadState('domcontentloaded')
  await window.waitForTimeout(1500) // let mount effects run

  // Try navigating to each main route via the in-app history (works regardless
  // of file:// base) and capture errors per route.
  const routes = ['/', '/accounts', '/skills', '/mcp', '/analytics', '/settings/general', '/settings/about']
  const perRoute: Record<string, number> = {}
  for (const r of routes) {
    const before = errors.length + consoleErrors.length
    await window.evaluate((path) => {
      // react-router BrowserRouter listens to history; pushState + popstate.
      window.history.pushState({}, '', path)
      window.dispatchEvent(new PopStateEvent('popstate'))
    }, r)
    await window.waitForTimeout(600)
    perRoute[r] = errors.length + consoleErrors.length - before
  }

  // Report everything we captured (visible in test output).
  console.log('=== PAGE ERRORS ===\n' + (errors.join('\n') || '(none)'))
  console.log('=== CONSOLE ERRORS ===\n' + (consoleErrors.join('\n') || '(none)'))
  console.log('=== ERRORS PER ROUTE ===\n' + JSON.stringify(perRoute, null, 2))

  // What is actually rendered at root after load?
  const rootInfo = await window.evaluate(() => {
    const root = document.getElementById('root')
    return {
      htmlLen: root?.innerHTML.length ?? 0,
      bodyText: (document.body.innerText || '').slice(0, 200),
      url: window.location.href,
    }
  })
  console.log('=== ROOT INFO ===\n' + JSON.stringify(rootInfo, null, 2))

  // This test always passes — it is a diagnostic. Assertions live in the smoke test.
  expect(true).toBe(true)
})
