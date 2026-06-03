import type { ErrorClass } from '../../../domain/platform-adapter'

/** 账号被风控封禁特征：403 + suspended 标记，或 423 Locked。token 有效，刷新无用。 */
export function isSuspendedResponse(status: number, bodyText: string): boolean {
  if (status === 423) return true
  if (status !== 403) return false
  return /TEMPORARILY_SUSPENDED|suspended|AccountSuspendedException/i.test(bodyText)
}

/** 上游 403（非 suspended）/封禁专用错误：runner 据此永久退役该账号。 */
export class KiroUpstreamSuspendedError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'KiroUpstreamSuspendedError'
  }
}

/** 把上游错误归到故障转移决策类别（用 err.name 判别，避免 import 造成循环）。 */
export function classifyKiroError(err: unknown): ErrorClass {
  const e = err as { name?: string; status?: number } | null
  if (e?.name === 'KiroUpstreamSuspendedError') return 'SUSPENDED'
  if (e?.name === 'KiroUpstreamAuthError') return 'AUTH'
  if (e?.name === 'KiroUpstreamError') {
    if (e.status === 429) return 'RATE_LIMIT'
    if (e.status === 400 || e.status === 422) return 'FATAL'
    return 'SERVER' // 5xx / 502
  }
  return 'SERVER' // 网络异常等
}
