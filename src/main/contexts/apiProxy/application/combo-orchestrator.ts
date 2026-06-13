// 组合链编排（application，纯逻辑，可单测）。
//
// runComboChain：按序对每一跳调 attempt；某跳成功(resolve)即返回；失败时用 shouldFallback 判定
// 是否跌落下一跳——可回退则记 lastError 继续，不可回退（如客户端 400）则立即抛出（每跳都会同样失败，
// 顺链无意义）。全链耗尽抛 lastError。流式的「首字节后不可回退」语义由调用方保证：ApiProxyService.dispatch
// 在返回流结果前已 peek 首个流事件（it.next()），首字节前的上游错误会在 attempt 内抛出 → 被这里捕获回退；
// 首字节一旦送出，attempt 已 resolve、不再进入回退分支。

/** 客户端错误：每一跳都会同样失败，顺链无意义 → 不回退，立即把该响应返回客户端。 */
const NON_FALLBACK_STATUSES: ReadonlySet<number> = new Set([400, 413, 422])

/**
 * 是否应跌落到组合的下一跳。
 * duck-type `err.status`（ApiProxyHttpError 带 status）以避免 import 造成的循环依赖：
 * - 有 status 且属客户端错误集(400/413/422) → false（不回退）
 * - 有 status 的其它情况(401/403/404/408/409/429/5xx 等) → true（回退）
 * - 无 status 的未知错误 → true（保守回退，对齐 9router 的默认可回退）
 */
export function shouldFallbackToNextStep(err: unknown): boolean {
  const status = (err as { status?: unknown } | null | undefined)?.status
  if (typeof status !== 'number') return true
  return !NON_FALLBACK_STATUSES.has(status)
}

/**
 * 按序遍历组合链：逐跳 attempt(stepModel, index)，首个成功即返回；可回退错误顺链继续，
 * 不可回退错误立即抛出；全链失败抛最后一个错误。空链抛错（调用方应已校验启用步骤非空）。
 */
export async function runComboChain<R>(
  stepModels: readonly string[],
  attempt: (stepModel: string, index: number) => Promise<R>,
  shouldFallback: (err: unknown) => boolean = shouldFallbackToNextStep,
): Promise<R> {
  if (stepModels.length === 0) {
    throw new Error('combo chain has no steps')
  }
  let lastError: unknown
  for (let i = 0; i < stepModels.length; i++) {
    try {
      return await attempt(stepModels[i], i)
    } catch (err) {
      if (!shouldFallback(err)) throw err
      lastError = err
    }
  }
  throw lastError
}
