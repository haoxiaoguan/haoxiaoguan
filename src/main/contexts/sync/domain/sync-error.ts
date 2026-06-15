// Sync error taxonomy.
//
// Display messages are Chinese (shown directly to the user);
// localizedEn() provides the English equivalent for locale-aware
// frontends. Network errors are sub-classed Timeout/Connect/Request so the
// frontend can give targeted hints and persist last_error_source.
//
// SyncError is a rich domain object (not an anemic struct): each variant is a
// factory that enforces its own message shape, and toString() yields the exact
// Chinese string the renderer's catch blocks expect.

export type NetworkKind = 'timeout' | 'connect' | 'request'

function networkZh(kind: NetworkKind): string {
  switch (kind) {
    case 'timeout':
      return '请求超时'
    case 'connect':
      return '无法连接到服务器'
    case 'request':
      return '网络请求失败'
  }
}

function networkEn(kind: NetworkKind): string {
  switch (kind) {
    case 'timeout':
      return 'Request timed out'
    case 'connect':
      return 'Failed to connect to server'
    case 'request':
      return 'Network request failed'
  }
}

export type SyncErrorKind =
  | 'network'
  | 'http'
  | 'integrity'
  | 'crypto'
  | 'config'
  | 'archive'
  | 'remoteEmpty'
  | 'versionIncompatible'
  | 'password'

/**
 * Tagged error for the whole sync flow. Construct via the static factories so
 * every variant keeps its invariant (Chinese display + English equivalent).
 */
export class SyncError extends Error {
  readonly kind: SyncErrorKind
  /** Network sub-classification (only for kind === 'network'). */
  readonly networkKind?: NetworkKind | undefined
  /** HTTP status (only for kind === 'http'). */
  readonly status?: number | undefined
  /** Protocol versions (only for kind === 'versionIncompatible'). */
  readonly expected?: number | undefined
  readonly actual?: number | undefined

  private constructor(
    kind: SyncErrorKind,
    message: string,
    extra: {
      networkKind?: NetworkKind
      status?: number
      expected?: number
      actual?: number
    } = {},
  ) {
    super(message)
    this.name = 'SyncError'
    this.kind = kind
    this.networkKind = extra.networkKind
    this.status = extra.status
    this.expected = extra.expected
    this.actual = extra.actual
    // Restore prototype chain (TS target downlevels Error subclassing).
    Object.setPrototypeOf(this, SyncError.prototype)
  }

  static network(kind: NetworkKind, detail: string): SyncError {
    return new SyncError('network', `${networkZh(kind)}: ${detail}`, { networkKind: kind })
  }

  static http(status: number, message: string): SyncError {
    return new SyncError('http', message, { status })
  }

  static integrity(detail: string): SyncError {
    return new SyncError('integrity', `完整性校验失败: ${detail}`)
  }

  static crypto(detail: string): SyncError {
    return new SyncError('crypto', `加密处理失败: ${detail}`)
  }

  static config(detail: string): SyncError {
    return new SyncError('config', `配置处理失败: ${detail}`)
  }

  static archive(detail: string): SyncError {
    return new SyncError('archive', `Skills 归档处理失败: ${detail}`)
  }

  static remoteEmpty(): SyncError {
    return new SyncError('remoteEmpty', '远端没有可用的同步数据')
  }

  static versionIncompatible(expected: number, actual: number): SyncError {
    return new SyncError(
      'versionIncompatible',
      `同步协议版本不兼容: 期望 ${expected}, 远端 ${actual}`,
      { expected, actual },
    )
  }

  static password(detail: string): SyncError {
    return new SyncError('password', `同步密码错误: ${detail}`)
  }

  /** English equivalent message, for locale-aware frontends. */
  localizedEn(): string {
    switch (this.kind) {
      case 'network':
        // message is `${zh}: ${detail}`; recover detail after the first ': '.
        return `${networkEn(this.networkKind ?? 'request')}: ${this.detailAfterColon()}`
      case 'http':
        return this.message
      case 'integrity':
        return `Integrity check failed: ${this.detailAfterColon()}`
      case 'crypto':
        return `Encryption error: ${this.detailAfterColon()}`
      case 'config':
        return `Config error: ${this.detailAfterColon()}`
      case 'archive':
        return `Skills archive error: ${this.detailAfterColon()}`
      case 'remoteEmpty':
        return 'No sync data available on remote'
      case 'versionIncompatible':
        return `Incompatible sync protocol version: expected ${this.expected}, remote ${this.actual}`
      case 'password':
        return `Sync password error: ${this.detailAfterColon()}`
    }
  }

  private detailAfterColon(): string {
    const idx = this.message.indexOf(': ')
    return idx >= 0 ? this.message.slice(idx + 2) : this.message
  }
}
