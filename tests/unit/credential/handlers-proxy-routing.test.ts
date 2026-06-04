/**
 * Tests that credential import handlers route enrichment requests through the
 * selected proxy (via runWithDispatcher) when proxyId is supplied, and fall
 * back to direct connection when proxyId is absent.
 *
 * Strategy: mock the ipcMain.handle registration so we can invoke the handler
 * logic directly, then assert that importService was called inside a
 * runWithDispatcher scope that carries the expected dispatcher.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Dispatcher } from 'undici'
import { currentDispatcher } from '../../../src/main/platform/net/dispatcher-context'

// ---- ipcMain stub ----
// We intercept ipcMain.handle to extract handler functions by channel name,
// then invoke them directly in tests (no Electron runtime needed).
type HandlerFn = (_e: unknown, args: unknown) => Promise<unknown>
const handlers = new Map<string, HandlerFn>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: HandlerFn) => {
      handlers.set(channel, fn)
    },
  },
}))

// ---- import after mocks ----
import { registerCredentialHandlers } from '../../../src/main/contexts/credential/ipc/credential-handlers'
import { CREDENTIAL_CHANNELS } from '../../../src/main/contexts/credential/ipc/credential-channels'

// Minimal ImportedCredentialMaterial fixture
const fakeMaterial = {
  provider: 'kiro',
  email: 'test@example.com',
  access_token: 'tok',
  refresh_token: 'ref',
  expires_at: null,
  source: 'token_json',
  raw_metadata: null,
}

describe('credential handlers — proxy routing via proxyId', () => {
  const fakeDispatcher = { marker: 'proxy-dispatcher' } as unknown as Dispatcher

  // Capture the dispatcher that was ambient during importService execution
  let capturedDispatcher: Dispatcher | undefined

  const importService = {
    importFromJson: vi.fn(async () => {
      capturedDispatcher = currentDispatcher()
      return fakeMaterial as any
    }),
    scanLocal: vi.fn(async () => {
      capturedDispatcher = currentDispatcher()
      return [fakeMaterial] as any
    }),
    importFromDeeplink: vi.fn(async () => {
      capturedDispatcher = currentDispatcher()
      return fakeMaterial as any
    }),
  }

  const proxyResolver = {
    dispatcherForProxyId: vi.fn(async (_id: string) => fakeDispatcher),
    dispatcherForAccount: vi.fn(async (_id: string) => fakeDispatcher),
  }

  const oauthService = {
    complete: vi.fn(async () => {
      capturedDispatcher = currentDispatcher()
      return fakeMaterial as any
    }),
  }
  const validationService = {} as any

  beforeEach(() => {
    handlers.clear()
    capturedDispatcher = undefined
    vi.clearAllMocks()
    proxyResolver.dispatcherForProxyId.mockResolvedValue(fakeDispatcher)
    proxyResolver.dispatcherForAccount.mockResolvedValue(fakeDispatcher)
    oauthService.complete.mockImplementation(async () => {
      capturedDispatcher = currentDispatcher()
      return fakeMaterial as any
    })
    importService.importFromJson.mockImplementation(async () => {
      capturedDispatcher = currentDispatcher()
      return fakeMaterial as any
    })
    importService.scanLocal.mockImplementation(async () => {
      capturedDispatcher = currentDispatcher()
      return [fakeMaterial] as any
    })
    importService.importFromDeeplink.mockImplementation(async () => {
      capturedDispatcher = currentDispatcher()
      return fakeMaterial as any
    })

    registerCredentialHandlers({
      oauthService,
      importService: importService as any,
      validationService,
      proxyResolver: proxyResolver as any,
    })
  })

  // --- import_token_json ---

  it('import_token_json: routes through proxy when proxyId is provided', async () => {
    const handler = handlers.get(CREDENTIAL_CHANNELS.importTokenJson)!
    await handler(null, { provider: 'kiro', payload: '{}', proxyId: 'p-1' })

    expect(proxyResolver.dispatcherForProxyId).toHaveBeenCalledWith('p-1')
    expect(capturedDispatcher).toBe(fakeDispatcher)
  })

  it('import_token_json: direct connection when proxyId is absent', async () => {
    const handler = handlers.get(CREDENTIAL_CHANNELS.importTokenJson)!
    await handler(null, { provider: 'kiro', payload: '{}' })

    expect(proxyResolver.dispatcherForProxyId).not.toHaveBeenCalled()
    expect(capturedDispatcher).toBeUndefined()
  })

  // --- scan_local_credentials ---

  it('scan_local_credentials: routes through proxy when proxyId is provided', async () => {
    const handler = handlers.get(CREDENTIAL_CHANNELS.scanLocalCredentials)!
    await handler(null, { provider: 'kiro', proxyId: 'p-2' })

    expect(proxyResolver.dispatcherForProxyId).toHaveBeenCalledWith('p-2')
    expect(capturedDispatcher).toBe(fakeDispatcher)
  })

  it('scan_local_credentials: direct connection when proxyId is absent', async () => {
    const handler = handlers.get(CREDENTIAL_CHANNELS.scanLocalCredentials)!
    await handler(null, { provider: 'kiro' })

    expect(proxyResolver.dispatcherForProxyId).not.toHaveBeenCalled()
    expect(capturedDispatcher).toBeUndefined()
  })

  // --- import_deeplink ---

  it('import_deeplink: routes through proxy when proxyId is provided', async () => {
    const handler = handlers.get(CREDENTIAL_CHANNELS.importDeeplink)!
    await handler(null, { provider: 'kiro', url: 'kiro://callback?code=abc', proxyId: 'p-3' })

    expect(proxyResolver.dispatcherForProxyId).toHaveBeenCalledWith('p-3')
    expect(capturedDispatcher).toBe(fakeDispatcher)
  })

  it('import_deeplink: direct connection when proxyId is absent', async () => {
    const handler = handlers.get(CREDENTIAL_CHANNELS.importDeeplink)!
    await handler(null, { provider: 'kiro', url: 'kiro://callback?code=abc' })

    expect(proxyResolver.dispatcherForProxyId).not.toHaveBeenCalled()
    expect(capturedDispatcher).toBeUndefined()
  })

  // --- complete_oauth ---

  it('complete_oauth: routes through proxy when proxyId is provided (import)', async () => {
    const handler = handlers.get(CREDENTIAL_CHANNELS.completeOauth)!
    await handler(null, { pendingId: 'pd-1', code: '', proxyId: 'p-4' })

    expect(proxyResolver.dispatcherForProxyId).toHaveBeenCalledWith('p-4')
    expect(proxyResolver.dispatcherForAccount).not.toHaveBeenCalled()
    expect(capturedDispatcher).toBe(fakeDispatcher)
  })

  it('complete_oauth: routes through the account proxy when accountId is provided (reauth)', async () => {
    const handler = handlers.get(CREDENTIAL_CHANNELS.completeOauth)!
    await handler(null, { pendingId: 'pd-2', code: '', accountId: 'a-1' })

    expect(proxyResolver.dispatcherForAccount).toHaveBeenCalledWith('a-1')
    expect(proxyResolver.dispatcherForProxyId).not.toHaveBeenCalled()
    expect(capturedDispatcher).toBe(fakeDispatcher)
  })

  it('complete_oauth: accountId takes precedence over proxyId', async () => {
    const handler = handlers.get(CREDENTIAL_CHANNELS.completeOauth)!
    await handler(null, { pendingId: 'pd-3', code: '', proxyId: 'p-x', accountId: 'a-2' })

    expect(proxyResolver.dispatcherForAccount).toHaveBeenCalledWith('a-2')
    expect(proxyResolver.dispatcherForProxyId).not.toHaveBeenCalled()
    expect(capturedDispatcher).toBe(fakeDispatcher)
  })

  it('complete_oauth: direct connection when neither proxyId nor accountId provided', async () => {
    const handler = handlers.get(CREDENTIAL_CHANNELS.completeOauth)!
    await handler(null, { pendingId: 'pd-4', code: '' })

    expect(proxyResolver.dispatcherForProxyId).not.toHaveBeenCalled()
    expect(proxyResolver.dispatcherForAccount).not.toHaveBeenCalled()
    expect(capturedDispatcher).toBeUndefined()
  })

  // --- backward-compat: no proxyResolver injected ---

  it('falls back to direct when proxyResolver is not injected (backward compat)', async () => {
    handlers.clear()
    registerCredentialHandlers({
      oauthService,
      importService: importService as any,
      validationService,
      // proxyResolver intentionally omitted
    })
    const handler = handlers.get(CREDENTIAL_CHANNELS.importTokenJson)!
    await handler(null, { provider: 'kiro', payload: '{}', proxyId: 'p-any' })

    expect(capturedDispatcher).toBeUndefined()
  })
})
