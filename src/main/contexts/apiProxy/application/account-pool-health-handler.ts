import type { AccountHealthTracker } from '../domain/account-selection/account-health-tracker'
import type { KiroAccountPort } from '../infrastructure/adapters/kiro/kiro-ports'
import type { AccountPoolHealthRow } from '../../../../shared/api-types'
import type { ProxyPoolService } from './proxy-pool-service'
import type { RoutingLogService } from './routing-log-service'
import type { RoutingWindow } from '../domain/observability/routing-log-record'

export type { AccountPoolHealthRow }

export interface PoolHealthDeps {
  health: AccountHealthTracker
  accounts: KiroAccountPort
  quotaResetMs: number
  /** 池成员服务（判定 pooled 标识）。缺省视为全部未入池。 */
  pool?: ProxyPoolService
  /** 路由日志服务（按账号聚合请求统计）。缺省视为统计全 0。 */
  routingLog?: RoutingLogService
}

/**
 * 合并账号库 meta（email/持久化 status）+ 运行态快照 + 入池标识 + 窗口内请求统计。
 * 供 IPC 查询账号池健康（卡片/表格双视图）。window 缺省取「全部已保留」（0..now）。
 */
export function makeAccountPoolHealthHandler(deps: PoolHealthDeps) {
  const { health, accounts, quotaResetMs, pool, routingLog } = deps
  return async (window?: RoutingWindow): Promise<AccountPoolHealthRow[]> => {
    const win: RoutingWindow = window ?? { startSec: 0, endSec: Math.floor(Date.now() / 1000) }
    const list = await accounts.listByPlatform()
    const stats = routingLog ? await routingLog.accountStats(win) : []
    const statById = new Map(stats.map((s) => [s.accountId, s]))
    return list.map((a) => {
      const snap = health.snapshot(a.id)
      const st = statById.get(a.id)
      return {
        accountId: a.id,
        // 当前账号源为 kiroAccountPort → 平台固定 'kiro'；多平台上游接入后由各自 port 提供。
        platform: 'kiro',
        email: a.email,
        ...(a.status !== undefined ? { status: a.status } : {}),
        runtimeState: snap.runtimeState,
        failureCount: snap.failureCount,
        ...(snap.cooldownUntilMs !== undefined ? { cooldownUntilMs: snap.cooldownUntilMs } : {}),
        ...(snap.rateLimitedUntilMs !== undefined ? { rateLimitedUntilMs: snap.rateLimitedUntilMs } : {}),
        // quota_exhausted（402）：恢复时间优先用真实重置时间（quotaExhaustedUntilMs，
        // 来自账号配额 resetAt）；缺失才退回「标记时刻 + 配置冷却」的旧估算。
        ...(snap.quotaExhaustedUntilMs !== undefined || snap.quotaExhaustedAtMs !== undefined
          ? {
              ...(snap.quotaExhaustedAtMs !== undefined
                ? { quotaExhaustedAtMs: snap.quotaExhaustedAtMs }
                : {}),
              quotaResetsAtMs:
                snap.quotaExhaustedUntilMs ??
                (snap.quotaExhaustedAtMs as number) + quotaResetMs,
            }
          : {}),
        pooled: pool?.has(a.id) ?? false,
        priority: pool?.getPriority(a.id) ?? 0,
        concurrency: pool?.getConcurrency(a.id) ?? 4,
        rateLimitCooldownMs: pool?.getRateLimitCooldownMs(a.id) ?? 0,
        requests: st?.requests ?? 0,
        success: st?.success ?? 0,
        failed: st?.failed ?? 0,
        rateLimited: st?.rateLimited ?? 0,
        avgDurationMs: st?.avgDurationMs ?? 0,
        peakRpm: st?.peakRpm ?? 0,
        inputTokens: st?.inputTokens ?? 0,
        outputTokens: st?.outputTokens ?? 0,
        cacheTokens: st?.cacheTokens ?? 0,
        ...(st?.lastTsMs ? { lastRequestMs: st.lastTsMs } : {}),
      }
    })
  }
}
