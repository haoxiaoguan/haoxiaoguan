// QuotaResetResolver factory — 把 quota 上下文桥接成 FailoverAdapter 的 QuotaResetResolverPort。
// 402 额度耗尽时，FailoverAdapter 用它解析「该账号下一次配额重置时间」，冷却到那一刻再放行。
//
// 混合策略（用户选定）：先读缓存（getQuotaState，命中且 resetAt 在未来直接用），
// 缺失/已过期再 live 刷新（refreshQuotaState）。每平台的 resetAt 解析由 quota 上下文负责
// （如 Kiro getUsageLimits 的 resetAt），这里只取归一化后 metrics 上的 resetAt。
import type { QuotaResetResolverPort } from '../contexts/apiProxy/domain/account-selection/failover-adapter'

/** quota 归一化状态的最小投影（仅需 metrics 上的 resetAt）。 */
interface QuotaStateLike {
  metrics: ReadonlyArray<{ resetAt?: Date | undefined }>
}

/** quota 应用服务的最小投影（缓存读 + live 刷新）。 */
interface QuotaServiceLike {
  getQuotaState(accountId: string): Promise<QuotaStateLike>
  refreshQuotaState(accountId: string): Promise<QuotaStateLike>
}

export interface QuotaResetResolverDeps {
  quotaService: QuotaServiceLike
  /** 注入时钟（测试用），默认 Date.now。 */
  clock?: () => number
}

/** 取状态里「最早的未来重置时间」（epoch ms）；没有未来重置点返回 undefined。 */
function earliestFutureResetMs(state: QuotaStateLike, now: number): number | undefined {
  let best: number | undefined
  for (const m of state.metrics) {
    if (!(m.resetAt instanceof Date)) continue
    const ms = m.resetAt.getTime()
    if (ms > now && (best === undefined || ms < best)) best = ms
  }
  return best
}

/**
 * 构造 QuotaResetResolverPort：resetAtForAccount 先查缓存、缺失/过期再 live，
 * 都拿不到则返回 undefined（FailoverAdapter 据此退回默认配额冷却）。
 */
export function makeQuotaResetResolver(deps: QuotaResetResolverDeps): QuotaResetResolverPort {
  const clock = deps.clock ?? Date.now
  return {
    async resetAtForAccount(accountId: string): Promise<number | undefined> {
      const now = clock()
      // ① 缓存优先：命中且重置时间在未来直接用（不发请求）。
      try {
        const cached = await deps.quotaService.getQuotaState(accountId)
        const hit = earliestFutureResetMs(cached, now)
        if (hit !== undefined) return hit
      } catch {
        /* 缓存读失败 → 落 live */
      }
      // ② 缺失/已过期：live 刷新再取（命中即返回）。
      try {
        const live = await deps.quotaService.refreshQuotaState(accountId)
        const hit = earliestFutureResetMs(live, now)
        if (hit !== undefined) return hit
      } catch {
        /* live 也失败 → undefined，调用方兜底 */
      }
      return undefined
    },
  }
}
