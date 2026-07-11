// Cursor 上游错误分类（喂 FailoverAdapter 决策），对齐 kiro-error 模式（用 err.name 判别，避免循环 import）。
import type { ErrorClass } from '../../../domain/platform-adapter'

/** 通用上游错误（携带 HTTP/上游状态码）。 */
export class CursorUpstreamError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'CursorUpstreamError'
  }
}

/** token 永久失效（刷新永久拿不到新 token）→ 移出反代池。 */
export class CursorTokenPermanentError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'CursorTokenPermanentError'
  }
}

/** 刷新后仍 401/403：token 能刷但仍被拒 → 鉴权错误，不移池。 */
export class CursorUpstreamAuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'CursorUpstreamAuthError'
  }
}

/** 额度耗尽 / 限速（cursor 上游返回 resource_exhausted 或 429）。 */
export class CursorRateLimitError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'CursorRateLimitError'
  }
}

/**
 * 归类到故障转移决策类别：
 * - CursorTokenPermanentError → DEPOOL（移出反代池）
 * - CursorUpstreamAuthError → AUTH
 * - CursorRateLimitError → RATE_LIMIT（429）/ QUOTA（402 额度耗尽）
 * - CursorUpstreamError → 按状态码：402=QUOTA / 429=RATE_LIMIT / 400·422=FATAL / 其余=SERVER
 * - 其它（网络异常）→ SERVER
 */
export function classifyCursorError(err: unknown): ErrorClass {
  const e = err as { name?: string; status?: number } | null
  if (e?.name === 'CursorTokenPermanentError') return 'DEPOOL'
  if (e?.name === 'CursorUpstreamAuthError') return 'AUTH'
  if (e?.name === 'CursorRateLimitError') return e.status === 402 ? 'QUOTA' : 'RATE_LIMIT'
  if (e?.name === 'CursorUpstreamError') {
    if (e.status === 402) return 'QUOTA'
    if (e.status === 429) return 'RATE_LIMIT'
    if (e.status === 400 || e.status === 422) return 'FATAL'
    return 'SERVER'
  }
  return 'SERVER'
}
