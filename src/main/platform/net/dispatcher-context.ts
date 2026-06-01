import { AsyncLocalStorage } from 'node:async_hooks'
import type { Dispatcher } from 'undici'

// Per-async-context proxy dispatcher.
//
// Electron's global fetch is undici. To route an account's outbound requests
// through a proxy we need to hand undici a `dispatcher`. Rather than thread a
// `dispatcher?` parameter through all ~11 quota fetchers (and risk one being
// missed — which would SILENTLY leak the real IP via a direct connection), we
// stash the resolved dispatcher in an AsyncLocalStorage. The single outbound
// chokepoint (quota/infrastructure/http/common.ts httpFetch) reads it.
//
// AsyncLocalStorage is per async-context, so concurrent multi-account refreshes
// never see each other's dispatcher — no global mutable state, concurrency-safe.

export const dispatcherContext = new AsyncLocalStorage<Dispatcher | undefined>()

/** Run `fn` with `dispatcher` as the ambient outbound dispatcher. */
export function runWithDispatcher<T>(
  dispatcher: Dispatcher | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  return dispatcherContext.run(dispatcher, fn)
}

/** The ambient dispatcher for the current async context, or undefined (direct). */
export function currentDispatcher(): Dispatcher | undefined {
  return dispatcherContext.getStore()
}
