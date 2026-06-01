import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'

// Real-device proof for the Kiro local-import fix. Kiro stores its credential in
// ~/.aws/sso/cache/kiro-auth-token.json (a PLAIN JSON file), NOT a VSCode
// SecretStorage secret:// blob. The earlier port wired Kiro to the generic
// SecretStorage reader, so scanLocalCredentials('kiro') always returned []
// ("无法导入本地账号"). This drives the SAME IPC the import UI uses, against the
// live install, through the bytecode bundle.
//
// SKIPPED automatically when this machine has no Kiro auth token on disk (CI),
// so the suite stays green on machines without Kiro installed.

const KIRO_AUTH = join(homedir(), '.aws', 'sso', 'cache', 'kiro-auth-token.json')
const haveKiro = existsSync(KIRO_AUTH)

let app: ElectronApplication
let userDataDir: string

test.afterEach(async () => {
  if (app) await app.close()
  if (userDataDir) rmSync(userDataDir, { recursive: true, force: true })
})

test('scanLocalCredentials("kiro") reads the AWS SSO token file', async () => {
  test.skip(!haveKiro, 'no ~/.aws/sso/cache/kiro-auth-token.json on this machine')

  userDataDir = mkdtempSync(join(tmpdir(), 'hxg-kiro-'))
  app = await electron.launch({
    args: ['out/main/main.cjs'],
    env: { ...process.env, HXG_USER_DATA_DIR: userDataDir },
  })
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')

  const materials = await window.evaluate(() =>
    (window as unknown as {
      api: {
        credential: {
          scanLocalCredentials(
            p: string,
          ): Promise<Array<{ provider: string; access_token: string; email: string; source: string }>>
        }
      }
    }).api.credential.scanLocalCredentials('kiro'),
  )

  // The live install must yield exactly one credential with a real token.
  expect(Array.isArray(materials)).toBe(true)
  expect(materials.length).toBe(1)
  const m = materials[0]
  expect(m.provider).toBe('kiro')
  expect(m.source).toBe('local_scan')
  expect(typeof m.access_token).toBe('string')
  expect(m.access_token.length).toBeGreaterThan(0)
  expect(typeof m.email).toBe('string')
  expect(m.email.length).toBeGreaterThan(0)
})
