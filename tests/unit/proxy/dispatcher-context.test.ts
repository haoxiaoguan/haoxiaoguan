import { describe, it, expect } from 'vitest'
import {
  dispatcherContext,
  runWithDispatcher,
  currentDispatcher,
} from '../../../src/main/platform/net/dispatcher-context'

// The dispatcher context is an AsyncLocalStorage<Dispatcher | undefined>. It lets
// QuotaService set a per-account proxy dispatcher that httpFetch (deep in the
// fetcher call stack) picks up WITHOUT threading a param through 11 fetchers.
// Per-async-context => concurrency-safe across parallel account refreshes.

describe('dispatcher-context', () => {
  it('exposes no dispatcher outside any run scope', () => {
    expect(currentDispatcher()).toBeUndefined()
  })

  it('exposes the dispatcher inside runWithDispatcher', async () => {
    const fakeDispatcher = { marker: 'D' } as unknown as Parameters<typeof runWithDispatcher>[0]
    const seen = await runWithDispatcher(fakeDispatcher, async () => currentDispatcher())
    expect(seen).toBe(fakeDispatcher)
  })

  it('restores no-dispatcher after the run scope ends', async () => {
    const fakeDispatcher = { marker: 'D' } as unknown as Parameters<typeof runWithDispatcher>[0]
    await runWithDispatcher(fakeDispatcher, async () => currentDispatcher())
    expect(currentDispatcher()).toBeUndefined()
  })

  it('keeps dispatchers isolated across concurrent async contexts', async () => {
    const dA = { id: 'A' } as unknown as Parameters<typeof runWithDispatcher>[0]
    const dB = { id: 'B' } as unknown as Parameters<typeof runWithDispatcher>[0]
    const [a, b] = await Promise.all([
      runWithDispatcher(dA, async () => {
        await new Promise((r) => setTimeout(r, 5))
        return currentDispatcher()
      }),
      runWithDispatcher(dB, async () => currentDispatcher()),
    ])
    expect(a).toBe(dA)
    expect(b).toBe(dB)
  })

  it('treats an undefined dispatcher run as direct (no dispatcher)', async () => {
    const seen = await runWithDispatcher(undefined, async () => currentDispatcher())
    expect(seen).toBeUndefined()
  })

  it('exports the underlying AsyncLocalStorage instance', () => {
    expect(dispatcherContext).toBeDefined()
    expect(typeof dispatcherContext.run).toBe('function')
  })
})
