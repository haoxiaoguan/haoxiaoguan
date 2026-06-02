import { SyncError, type NetworkKind } from '../domain/sync-error'
import type { WebDavAuth, WebDavClient } from '../domain/webdav-client'

// FetchWebDavClient — Node `fetch`-based WebDAV client.
// Behavior:
//   - custom PROPFIND / MKCOL methods + standard PUT / GET / HEAD,
//   - tiered timeouts (30s for PROPFIND/MKCOL/HEAD, 300s for PUT/GET) via
//     AbortController,
//   - GET dual size guard (Content-Length pre-check + post-read length check),
//   - URL log redaction, Jianguoyun (jianguoyun.com / nutstore) error hints,
//   - MKCOL ambiguity (405/409/3xx → PROPFIND confirm).
//
// Node 18+ ships a global `fetch` (undici) that supports arbitrary HTTP methods,
// which is exactly what the WebDAV verbs need.

/** Normal request (PROPFIND/MKCOL/HEAD) timeout. */
const DEFAULT_TIMEOUT_MS = 30_000
/** Large transfer (PUT/GET) timeout. */
const TRANSFER_TIMEOUT_MS = 300_000

const HTTP_OK_MULTISTATUS = 207
const HTTP_CREATED = 201
const HTTP_NOT_FOUND = 404
const HTTP_UNAUTHORIZED = 401
const HTTP_FORBIDDEN = 403
const HTTP_METHOD_NOT_ALLOWED = 405
const HTTP_CONFLICT = 409

function isSuccess(status: number): boolean {
  return status >= 200 && status < 300
}

function isRedirection(status: number): boolean {
  return status >= 300 && status < 400
}

/** Is this a Jianguoyun (Nutstore) host? Drives special error hints. */
function isJianguoyun(url: string): boolean {
  const lower = url.toLowerCase()
  return lower.includes('jianguoyun.com') || lower.includes('nutstore')
}

/**
 * Redact a URL for safe logging/messages: strip user:pass@ credentials, drop
 * query VALUES (keep sorted unique keys). Hand-written parse (no URL crate dep),
 * mirroring the source `redact_url`.
 */
export function redactUrl(raw: string): string {
  const schemeSplit = raw.indexOf('://')
  if (schemeSplit < 0) {
    return raw.split('?')[0]
  }
  const scheme = raw.slice(0, schemeSplit)
  const rest = raw.slice(schemeSplit + 3)

  const qIdx = rest.indexOf('?')
  const authorityPath = qIdx >= 0 ? rest.slice(0, qIdx) : rest
  const query = qIdx >= 0 ? rest.slice(qIdx + 1) : null

  const slashIdx = authorityPath.indexOf('/')
  const authority = slashIdx >= 0 ? authorityPath.slice(0, slashIdx) : authorityPath
  const path = slashIdx >= 0 ? authorityPath.slice(slashIdx) : ''

  const atIdx = authority.lastIndexOf('@')
  const host = atIdx >= 0 ? authority.slice(atIdx + 1) : authority

  let out = `${scheme}://${host}${path}`
  if (query) {
    const keys = [
      ...new Set(
        query
          .split('&')
          .filter((kv) => kv.length > 0)
          .map((kv) => kv.split('=')[0]),
      ),
    ].sort()
    if (keys.length > 0) {
      out += `?[keys:${keys.join(',')}]`
    }
  }
  return out
}

/** Build a Basic-auth header value, or undefined for no auth. */
function basicAuthHeader(auth: WebDavAuth): string | undefined {
  if (!auth) return undefined
  const token = Buffer.from(`${auth.username}:${auth.password}`, 'utf8').toString('base64')
  return `Basic ${token}`
}

/** Classify a fetch/network throw into a SyncError.network. */
function classifyFetchError(err: unknown, url: string, timedOut: boolean): SyncError {
  let kind: NetworkKind = 'request'
  if (timedOut) {
    kind = 'timeout'
  } else {
    const msg = (err as Error)?.message?.toLowerCase() ?? ''
    const cause = ((err as { cause?: { code?: string } })?.cause?.code ?? '').toUpperCase()
    if (
      cause === 'ECONNREFUSED' ||
      cause === 'ENOTFOUND' ||
      cause === 'EAI_AGAIN' ||
      cause === 'ECONNRESET' ||
      msg.includes('failed to fetch') ||
      msg.includes('fetch failed') ||
      msg.includes('connect')
    ) {
      kind = 'connect'
    }
  }
  return SyncError.network(kind, redactUrl(url))
}

/** Non-success HTTP status → SyncError.http with redacted URL + Jianguoyun hints. */
function httpStatusError(op: string, status: number, url: string): SyncError {
  const safe = redactUrl(url)
  const jgy = isJianguoyun(url)
  let zh = `WebDAV ${op} 失败: ${status} (${safe})`

  if (status === HTTP_UNAUTHORIZED || status === HTTP_FORBIDDEN) {
    zh += jgy
      ? '。坚果云请使用「第三方应用密码」，并确认地址指向 /dav/ 下的目录。'
      : '。请检查 WebDAV 用户名、密码及目录读写权限。'
  } else if (jgy && (status === HTTP_NOT_FOUND || isRedirection(status))) {
    zh += '。坚果云常见原因：地址不在 /dav/ 可写目录下。'
  } else if (op === 'MKCOL' && status === HTTP_CONFLICT) {
    zh += jgy
      ? '。坚果云不允许自动创建顶层文件夹，请先在网页端手动创建后重试。'
      : '。请确认上级目录存在。'
  }

  return SyncError.http(status, zh)
}

/** Extract the ETag response header (null when absent). */
function extractEtag(headers: Headers): string | null {
  return headers.get('etag')
}

/**
 * Perform a fetch with an AbortController-driven timeout. Re-throws fetch errors
 * classified as SyncError.network; the caller handles non-2xx statuses.
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (e) {
    throw classifyFetchError(e, url, timedOut)
  } finally {
    clearTimeout(timer)
  }
}

/** PROPFIND Depth:0 existence probe (used to confirm ambiguous MKCOL results). */
async function propfindExists(url: string, auth: WebDavAuth): Promise<boolean> {
  const headers: Record<string, string> = { Depth: '0' }
  const a = basicAuthHeader(auth)
  if (a) headers.Authorization = a
  const resp = await fetchWithTimeout(url, { method: 'PROPFIND', headers }, DEFAULT_TIMEOUT_MS)
  return isSuccess(resp.status) || resp.status === HTTP_OK_MULTISTATUS
}

export class FetchWebDavClient implements WebDavClient {
  async testConnection(baseUrl: string, auth: WebDavAuth): Promise<void> {
    const headers: Record<string, string> = { Depth: '0' }
    const a = basicAuthHeader(auth)
    if (a) headers.Authorization = a
    const resp = await fetchWithTimeout(
      baseUrl,
      { method: 'PROPFIND', headers },
      DEFAULT_TIMEOUT_MS,
    )
    if (isSuccess(resp.status) || resp.status === HTTP_OK_MULTISTATUS) {
      return
    }
    throw httpStatusError('PROPFIND', resp.status, baseUrl)
  }

  async ensureRemoteDirectories(
    baseUrl: string,
    segments: string[],
    auth: WebDavAuth,
  ): Promise<void> {
    // Walk segment-by-segment, MKCOL'ing each level. base_url is assumed to
    // already exist; build the path incrementally with percent-encoded segments.
    let current = baseUrl.replace(/\/+$/, '')
    const a = basicAuthHeader(auth)
    for (const seg of segments) {
      const s = seg.replace(/^\/+|\/+$/g, '')
      if (s.length === 0) continue
      current += '/' + encodeURIComponent(s)
      const dirUrl = `${current}/`

      const headers: Record<string, string> = {}
      if (a) headers.Authorization = a
      const resp = await fetchWithTimeout(dirUrl, { method: 'MKCOL', headers }, DEFAULT_TIMEOUT_MS)
      const status = resp.status

      if (status === HTTP_CREATED || isSuccess(status)) {
        continue
      }
      // Ambiguous: directory may already exist. Confirm via PROPFIND.
      if (status === HTTP_METHOD_NOT_ALLOWED || status === HTTP_CONFLICT || isRedirection(status)) {
        if (!(await propfindExists(dirUrl, auth))) {
          throw httpStatusError('MKCOL', status, dirUrl)
        }
        continue
      }
      throw httpStatusError('MKCOL', status, dirUrl)
    }
  }

  async putBytes(
    url: string,
    auth: WebDavAuth,
    bytes: Buffer,
    contentType: string,
  ): Promise<void> {
    const headers: Record<string, string> = { 'Content-Type': contentType }
    const a = basicAuthHeader(auth)
    if (a) headers.Authorization = a
    const resp = await fetchWithTimeout(
      url,
      // Pass a fresh Uint8Array view so undici treats it as a byte body.
      { method: 'PUT', headers, body: new Uint8Array(bytes) },
      TRANSFER_TIMEOUT_MS,
    )
    if (isSuccess(resp.status)) {
      return
    }
    throw httpStatusError('PUT', resp.status, url)
  }

  async getBytes(
    url: string,
    auth: WebDavAuth,
    maxBytes: number,
  ): Promise<{ bytes: Buffer; etag: string | null } | null> {
    const headers: Record<string, string> = {}
    const a = basicAuthHeader(auth)
    if (a) headers.Authorization = a
    const resp = await fetchWithTimeout(url, { method: 'GET', headers }, TRANSFER_TIMEOUT_MS)
    const status = resp.status
    if (status === HTTP_NOT_FOUND) {
      return null
    }
    if (!isSuccess(status)) {
      throw httpStatusError('GET', status, url)
    }

    const etag = extractEtag(resp.headers)

    // Content-Length pre-check (when the server provides it).
    const lenHeader = resp.headers.get('content-length')
    if (lenHeader != null) {
      const len = Number(lenHeader)
      if (Number.isFinite(len) && len > maxBytes) {
        throw SyncError.integrity(`${redactUrl(url)} 响应体 ${len} 字节超过上限 ${maxBytes}`)
      }
    }

    // Read the full body, then re-check size (guards against missing/lying
    // Content-Length, e.g. chunked transfer or zip-bomb attempts).
    let bytes: Buffer
    try {
      const ab = await resp.arrayBuffer()
      bytes = Buffer.from(ab)
    } catch (e) {
      throw classifyFetchError(e, url, false)
    }
    if (bytes.length > maxBytes) {
      throw SyncError.integrity(`${redactUrl(url)} 响应体超过上限 ${maxBytes}`)
    }
    return { bytes, etag }
  }

  async headEtag(url: string, auth: WebDavAuth): Promise<string | null> {
    const headers: Record<string, string> = {}
    const a = basicAuthHeader(auth)
    if (a) headers.Authorization = a
    const resp = await fetchWithTimeout(url, { method: 'HEAD', headers }, DEFAULT_TIMEOUT_MS)
    if (!isSuccess(resp.status)) {
      return null
    }
    return extractEtag(resp.headers)
  }
}
