import { randomBytes } from 'node:crypto'
import { fetch as undiciFetch } from 'undici'
import { currentDispatcher } from '../../../../platform/net/dispatcher-context'

// Shared HTTP + small utils for the OAuth capabilities. Every capability routes
// its outbound token/userinfo calls through the ambient per-account/proxy
// dispatcher (currentDispatcher, set by the IPC handler via runWithDispatcher)
// so OAuth exchanges never leak the real IP when a proxy is bound. With no
// dispatcher it falls back to the global fetch (direct connection).

export type OAuthFetch = (url: string, init: RequestInit) => Promise<Response>

// Token exchanges / userinfo / device-poll must not hang forever: a stalled
// connection would leave the "add account" dialog spinning with no feedback.
// Cap each request so failures surface as a rejected promise the UI can show.
export const OAUTH_HTTP_TIMEOUT_MS = 30_000

export async function dispatcherFetch(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), OAUTH_HTTP_TIMEOUT_MS)
  const dispatcher = currentDispatcher()
  try {
    if (dispatcher !== undefined) {
      return (await undiciFetch(url, {
        ...(init as unknown as Parameters<typeof undiciFetch>[1]),
        dispatcher,
        signal: controller.signal,
      })) as unknown as Response
    }
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/** Random 32-byte base64url token (PKCE verifier / state / login id). */
export function token32(): string {
  return randomBytes(32).toString('base64url')
}

export function normalizeNonEmpty(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined
  const t = value.trim()
  return t.length > 0 ? t : undefined
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
