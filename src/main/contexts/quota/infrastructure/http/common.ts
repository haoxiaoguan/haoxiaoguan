// Shared HTTP-fetcher helpers.
//
// All quota fetchers build a fresh request per call with a 25s timeout (via
// AbortController). JWT decode is base64url (no verification). success_result
// runs the per-platform profile parser to derive models from the normalised
// state.

import type { JsonValue } from '../../../account/domain/platform-account-profile'
import { Credential } from '../../../account/domain/credential'
import { ModelQuota } from '../../domain/quota'
import type { PlatformId } from '../../domain/platform-id'
import type { QuotaFetchResult } from '../../domain/capabilities'
import { currentDispatcher } from '../../../../platform/net/dispatcher-context'
import { fetch as undiciFetch } from 'undici'
import {
  fromAccountProfile,
  getPathValue,
  type AccountQuotaState,
  type QuotaMetric,
} from '../../domain/quota-state'

export const QUOTA_HTTP_TIMEOUT_MS = 25_000

export class ProviderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProviderError'
    Object.setPrototypeOf(this, ProviderError.prototype)
  }
}

export function providerError(message: string): ProviderError {
  return new ProviderError(message)
}

/**
 * fetch() with a 25s timeout. Throws ProviderError on network failure.
 *
 * When an ambient proxy dispatcher is set for the current async context (see
 * platform/net/dispatcher-context), the request is routed through it using
 * undici's own fetch — the global fetch's RequestInit type doesn't expose
 * `dispatcher`, and mixing our undici Dispatcher with Electron's bundled undici
 * fetch fails the instanceof check. With no dispatcher, behaviour is unchanged
 * (global fetch, direct connection).
 */
export async function httpFetch(
  url: string,
  init: RequestInit,
  describe: string,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), QUOTA_HTTP_TIMEOUT_MS)
  const dispatcher = currentDispatcher()
  try {
    if (dispatcher !== undefined) {
      const response = await undiciFetch(url, {
        ...(init as Parameters<typeof undiciFetch>[1]),
        signal: controller.signal,
        dispatcher,
      })
      return response as unknown as Response
    }
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (err) {
    const base = err instanceof Error ? err.message : String(err)
    const causeMsg = err instanceof Error && err.cause instanceof Error ? ` [cause: ${err.cause.message}]` : ''
    throw providerError(`${describe}: ${base}${causeMsg}`)
  } finally {
    clearTimeout(timer)
  }
}

export async function parseJson(response: Response, describe: string): Promise<JsonValue> {
  try {
    return (await response.json()) as JsonValue
  } catch (err) {
    throw providerError(`${describe}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export function normalizeNonEmpty(value: string | undefined | null): string | undefined {
  if (value === undefined || value === null) return undefined
  const trimmed = value.trim()
  return trimmed.length === 0 ? undefined : trimmed
}

export function pickStringHttp(
  root: JsonValue | undefined,
  paths: readonly (readonly string[])[],
): string | undefined {
  if (root === undefined) return undefined
  for (const path of paths) {
    const value = getPathValue(root, path)
    const text = valueToStringHttp(value)
    const normalized = normalizeNonEmpty(text)
    if (normalized !== undefined) return normalized
  }
  return undefined
}

export function pickI64Http(
  root: JsonValue | undefined,
  paths: readonly (readonly string[])[],
): number | undefined {
  if (root === undefined) return undefined
  for (const path of paths) {
    const value = getPathValue(root, path)
    if (value === undefined) continue
    if (typeof value === 'number') return Math.round(value)
    if (typeof value === 'string') {
      const parsed = Number.parseInt(value.trim(), 10)
      if (!Number.isNaN(parsed)) return parsed
    }
  }
  return undefined
}

function valueToStringHttp(value: JsonValue | undefined): string | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'string') return normalizeNonEmpty(value)
  if (typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return String(value)
  return undefined
}

/** base64url JWT payload decode (no signature verification). */
export function jwtPayload(token: string): JsonValue | undefined {
  const segment = token.split('.')[1]
  if (segment === undefined) return undefined
  try {
    const normalized = segment.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
    const json = Buffer.from(padded, 'base64').toString('utf8')
    return JSON.parse(json) as JsonValue
  } catch {
    return undefined
  }
}

export function jwtClaimString(token: string, key: string): string | undefined {
  const payload = jwtPayload(token)
  if (payload === undefined) return undefined
  const value = getPathValue(payload, [key])
  return typeof value === 'string' ? normalizeNonEmpty(value) : undefined
}

/** True if the JWT exp is within the next minute (refresh needed). */
export function jwtNeedsRefresh(token: string): boolean {
  const payload = jwtPayload(token)
  if (payload === undefined) return false
  const exp = getPathValue(payload, ['exp'])
  let expSeconds: number | undefined
  if (typeof exp === 'number') expSeconds = exp
  else if (typeof exp === 'string') {
    const parsed = Number.parseInt(exp, 10)
    if (!Number.isNaN(parsed)) expSeconds = parsed
  }
  if (expSeconds === undefined) return false
  return expSeconds <= Math.trunc(Date.now() / 1000) + 60
}

/** Normalise an epoch (seconds or millis) to a Date. */
export function timestampToDate(ts: number): Date {
  const seconds = ts > 10_000_000_000 ? Math.trunc(ts / 1000) : ts
  return new Date(seconds * 1000)
}

function isPlainObject(value: JsonValue | undefined): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Shallow-merge two JSON objects (right wins). */
export function mergePayload(left: JsonValue | undefined, right: JsonValue): JsonValue {
  const merged: { [key: string]: JsonValue } = isPlainObject(left) ? { ...left } : {}
  if (isPlainObject(right)) {
    for (const [key, value] of Object.entries(right)) merged[key] = value
  }
  return merged
}

/** Build a Credential carrying the merged provider payload as raw_metadata. */
export function credentialWithPayload(
  credential: Credential,
  accessToken: string,
  refreshToken: string | undefined,
  expiresAt: Date | undefined,
  providerPayload: JsonValue,
): Credential {
  return new Credential(
    accessToken,
    refreshToken ?? credential.refreshToken,
    expiresAt ?? credential.expiresAt,
    mergePayload(credential.rawMetadata, providerPayload),
  )
}

/** Build a successful QuotaFetchResult, deriving models from the parsed state. */
export function successResult(
  platform: PlatformId,
  credential: Credential,
  providerPayload: JsonValue,
  updatedCredential: Credential | undefined,
): QuotaFetchResult {
  const state = fromAccountProfile(platform, providerPayload, credential.rawMetadata)
  return {
    outcome: 'success',
    source: 'live',
    freshness: 'fresh',
    fetchedAt: new Date(),
    models: state !== undefined ? modelsFromQuotaState(state) : [],
    providerPayload,
    updatedCredential,
    error: undefined,
  }
}

function modelsFromQuotaState(state: AccountQuotaState): ModelQuota[] {
  const models: ModelQuota[] = []
  for (const metric of state.metrics) {
    const total = totalForMetric(metric)
    if (total === undefined) continue
    const totalRounded = Math.max(0, Math.round(total))
    const used = Math.max(0, Math.round(usedForMetric(metric)))
    models.push(new ModelQuota(metric.key, used, Math.max(totalRounded, used), metric.resetAt))
  }
  return models
}

function totalForMetric(metric: QuotaMetric): number | undefined {
  if (metric.total !== undefined) return metric.total
  if (metric.percentUsed !== undefined || metric.percentRemaining !== undefined) return 100
  return undefined
}

function usedForMetric(metric: QuotaMetric): number {
  if (metric.used !== undefined) return metric.used
  if (metric.percentUsed !== undefined) return clamp(metric.percentUsed, 0, 100)
  if (metric.percentRemaining !== undefined) return Math.max(0, 100 - clamp(metric.percentRemaining, 0, 100))
  return 0
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
