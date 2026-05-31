import { SyncError } from './sync-error'

// WebDAV client port (interface) + pure URL/auth helpers — 对应
// modules/sync/domain/webdav_client.rs.
//
// The interface is implemented in infrastructure (ReqwestWebDavClient → here a
// Node fetch-based client). Keeping it a port lets the application orchestration
// be tested with an in-memory fake. All URLs passed to the client are absolute.

/** Basic-auth credentials; null means no auth (empty username). */
export type WebDavAuth = { username: string; password: string } | null

export interface WebDavClient {
  /** PROPFIND Depth:0 to test connectivity + directory reachability. */
  testConnection(baseUrl: string, auth: WebDavAuth): Promise<void>

  /** MKCOL each path segment in turn (already-exists treated as success). */
  ensureRemoteDirectories(baseUrl: string, segments: string[], auth: WebDavAuth): Promise<void>

  /** PUT bytes to an absolute URL. */
  putBytes(url: string, auth: WebDavAuth, bytes: Buffer, contentType: string): Promise<void>

  /**
   * GET bytes from an absolute URL, rejecting bodies over maxBytes. Returns the
   * body + ETag, or null on 404.
   */
  getBytes(
    url: string,
    auth: WebDavAuth,
    maxBytes: number,
  ): Promise<{ bytes: Buffer; etag: string | null } | null>

  /** HEAD to fetch the ETag (best-effort; null when absent). */
  headEtag(url: string, auth: WebDavAuth): Promise<string | null>
}

/** Build auth from username/password; empty/whitespace username → no auth. */
export function authFromCredentials(username: string, password: string): WebDavAuth {
  const user = username.trim()
  if (user.length === 0) {
    return null
  }
  return { username: user, password }
}

/**
 * Join base_url + URL-encoded path segments with `/`. Trailing slash on base is
 * normalized; empty segments are skipped (avoids `//`); each segment is
 * percent-encoded (segments are single names, never separators).
 */
export function buildRemoteUrl(baseUrl: string, segments: string[]): string {
  const base = baseUrl.trim()
  if (base.length === 0) {
    throw SyncError.config('WebDAV base_url 为空')
  }
  if (!base.startsWith('http://') && !base.startsWith('https://')) {
    throw SyncError.config(`WebDAV base_url 必须以 http:// 或 https:// 开头: ${base}`)
  }
  let url = base.replace(/\/+$/, '')
  for (const seg of segments) {
    const s = seg.replace(/^\/+|\/+$/g, '')
    if (s.length === 0) {
      continue
    }
    url += '/' + encodeURIComponent(s)
  }
  return url
}
