// Proxy domain value objects.
//
// A Proxy is an outbound HTTP/HTTPS/SOCKS5 relay the app routes account-scoped
// requests through to avoid same-IP multi-account risk. Passwords live ONLY in
// encrypted form at rest (proxies.password_enc); the in-memory `Proxy` carries
// the decrypted password only transiently when building a dispatcher or testing.
// DTOs that leave the main process never carry the plaintext password.

export type ProxyProtocol = 'http' | 'https' | 'socks5'

export const PROXY_PROTOCOLS: readonly ProxyProtocol[] = ['http', 'https', 'socks5']

export function isProxyProtocol(value: string): value is ProxyProtocol {
  return (PROXY_PROTOCOLS as readonly string[]).includes(value)
}

export type ProxyStatus = 'unknown' | 'ok' | 'failed'

/** Connectivity probe result written back after a test. */
export interface ProxyCheckResult {
  status: Exclude<ProxyStatus, 'unknown'>
  egressIp?: string | undefined
  latencyMs?: number | undefined
  error?: string | undefined
  checkedAt: Date
}

/** A parsed/persisted proxy. `password` is plaintext and present only in memory. */
export interface Proxy {
  id: string
  label?: string | undefined
  protocol: ProxyProtocol
  host: string
  port: number
  username?: string | undefined
  password?: string | undefined
  status: ProxyStatus
  lastEgressIp?: string | undefined
  lastLatencyMs?: number | undefined
  lastCheckedAt?: Date | undefined
  tags: string[]
  createdAt: Date
}

/** account → proxy. A bound account routes outbound traffic through proxyId. */
export interface AccountProxyBinding {
  accountId: string
  proxyId?: string | undefined
  createdAt: Date
}

/** Stable dedupe key: protocol+host+port+username. */
export function proxyDedupeKey(p: {
  protocol: ProxyProtocol
  host: string
  port: number
  username?: string | undefined
}): string {
  return `${p.protocol}://${p.username ?? ''}@${p.host}:${p.port}`
}

/**
 * Build the wire URL for a dispatcher (carries auth). For SOCKS5 the scheme is
 * `socks5`; for http/https the scheme matches the protocol. Credentials are
 * URL-encoded so passwords with special chars survive.
 */
export function proxyUrl(p: {
  protocol: ProxyProtocol
  host: string
  port: number
  username?: string | undefined
  password?: string | undefined
}): string {
  const auth =
    p.username !== undefined && p.username !== ''
      ? `${encodeURIComponent(p.username)}:${encodeURIComponent(p.password ?? '')}@`
      : ''
  return `${p.protocol}://${auth}${p.host}:${p.port}`
}

/** Redacted form for logs/DTOs — auth is replaced by `***`. */
export function redactProxyUrl(p: {
  protocol: ProxyProtocol
  host: string
  port: number
  username?: string | undefined
}): string {
  const auth = p.username !== undefined && p.username !== '' ? `${p.username}:***@` : ''
  return `${p.protocol}://${auth}${p.host}:${p.port}`
}
