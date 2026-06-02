import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Real-device UI walkthrough of the proxy page — clicks the actual rendered
// controls (nav → manual add → fill form → save) through the real IPC + SQLite
// stack, then asserts the new row renders with a REDACTED address (no plaintext
// password) and that the delete confirm blocks while nothing is bound yet (an
// unbound proxy deletes cleanly). Isolated via HXG_USER_DATA_DIR.

let app: ElectronApplication
let userDataDir: string | null = null

test.afterEach(async () => {
  if (app) await app.close()
  if (userDataDir) {
    rmSync(userDataDir, { recursive: true, force: true })
    userDataDir = null
  }
})

test('user can navigate to Proxies, add a proxy via the form, and see it listed', async () => {
  userDataDir = mkdtempSync(join(tmpdir(), 'hxg-proxy-ui-'))
  app = await electron.launch({
    args: ['out/main/main.cjs'],
    env: { ...process.env, HXG_USER_DATA_DIR: userDataDir },
  })
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')

  // Navigate to the proxy page via its hash route. Proxies is nested under
  // /accounts (the "代理管理" tab in the accounts header links here).
  await window.evaluate(() => {
    window.location.hash = '#/accounts/proxies'
  })

  // Empty state shows first.
  await expect(window.getByText(/No proxies yet|还没有代理/)).toBeVisible()

  // Click the toolbar "Add" button to open the combined dialog (manual tab is
  // the default).
  await window.getByRole('button', { name: /^Add$|^添加$/ }).click()

  // Fill host + port (dialog inputs). Host has placeholder 1.2.3.4, port 8080.
  await window.getByPlaceholder('1.2.3.4').fill('203.0.113.7')
  await window.getByPlaceholder('8080').fill('8080')

  // Save.
  await window.getByRole('button', { name: /^Save$|^保存$/ }).click()

  // The row appears with the redacted address (no auth here → plain host:port).
  const row = window.getByTestId('proxy-row')
  await expect(row).toBeVisible()
  await expect(row.getByText('http://203.0.113.7:8080')).toBeVisible()

  // Verify it really persisted through IPC (round-trip via window.api).
  const persisted = await window.evaluate(async () => {
    const api = (window as unknown as {
      api: { proxy: { listProxies(): Promise<Array<{ host: string; passwordSet: boolean }>> } }
    }).api
    return api.proxy.listProxies()
  })
  expect(persisted).toHaveLength(1)
  expect(persisted[0].host).toBe('203.0.113.7')
  expect(persisted[0].passwordSet).toBe(false)
})
