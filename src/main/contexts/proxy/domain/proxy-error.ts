// Proxy domain errors. Connectivity failures are classified so the UI can show a
// meaningful reason (and so test-connectivity and real requests share one
// taxonomy). Messages never embed credentials — callers pass already-redacted
// proxy identifiers.

export type ProxyErrorKind =
  | 'not_found'
  | 'connect_timeout'
  | 'auth_failed'
  | 'dns_failed'
  | 'connection_refused'
  | 'in_use' // delete blocked: still bound
  | 'duplicate'
  | 'malformed_input'
  | 'storage_error'
  | 'internal'

export class ProxyError extends Error {
  readonly kind: ProxyErrorKind
  readonly data: Record<string, unknown>

  private constructor(kind: ProxyErrorKind, message: string, data: Record<string, unknown> = {}) {
    super(message)
    this.name = 'ProxyError'
    this.kind = kind
    this.data = data
    Object.setPrototypeOf(this, ProxyError.prototype)
  }

  static notFound(id: string): ProxyError {
    return new ProxyError('not_found', `proxy not found: ${id}`, { id })
  }

  static connectTimeout(target: string): ProxyError {
    return new ProxyError('connect_timeout', `proxy connect timeout: ${target}`, { target })
  }

  static authFailed(target: string): ProxyError {
    return new ProxyError('auth_failed', `proxy authentication failed: ${target}`, { target })
  }

  static dnsFailed(target: string): ProxyError {
    return new ProxyError('dns_failed', `proxy DNS resolution failed: ${target}`, { target })
  }

  static connectionRefused(target: string): ProxyError {
    return new ProxyError('connection_refused', `proxy connection refused: ${target}`, { target })
  }

  /** Delete blocked because the proxy is still bound to accounts/groups. */
  static inUse(proxyId: string, accountCount: number, groupCount: number): ProxyError {
    return new ProxyError(
      'in_use',
      `proxy ${proxyId} is still used by ${accountCount} account(s) and ${groupCount} group(s)`,
      { proxyId, accountCount, groupCount },
    )
  }

  static duplicate(key: string): ProxyError {
    return new ProxyError('duplicate', `duplicate proxy: ${key}`, { key })
  }

  static malformedInput(field: string): ProxyError {
    return new ProxyError('malformed_input', `malformed input: field=${field}`, { field })
  }

  static storageError(message: string): ProxyError {
    return new ProxyError('storage_error', `storage error: ${message}`, { message })
  }

  static internal(message: string): ProxyError {
    return new ProxyError('internal', `internal: ${message}`, { message })
  }
}

/**
 * Map a low-level network error (from undici/socks during connect) to a
 * classified ProxyError. `target` must already be redacted (no credentials).
 */
export function classifyProxyError(err: unknown, target: string): ProxyError {
  const message = err instanceof Error ? err.message : String(err)
  const code = (err as { code?: string }).code
  const lower = message.toLowerCase()
  if (code === 'ETIMEDOUT' || lower.includes('timeout') || lower.includes('timed out')) {
    return ProxyError.connectTimeout(target)
  }
  if (
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN' ||
    lower.includes('getaddrinfo') ||
    lower.includes('dns')
  ) {
    return ProxyError.dnsFailed(target)
  }
  if (code === 'ECONNREFUSED' || lower.includes('refused')) {
    return ProxyError.connectionRefused(target)
  }
  if (
    lower.includes('407') ||
    lower.includes('authentication') ||
    lower.includes('auth') ||
    lower.includes('credentials')
  ) {
    return ProxyError.authFailed(target)
  }
  return ProxyError.internal(`${target}: ${message}`)
}
