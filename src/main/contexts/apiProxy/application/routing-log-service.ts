// 路由日志分析模块 · 应用服务。
//
// 写路径：ProxyRequestLog.record() → persistSink → enqueue()（同步、非阻塞，仅入内存缓冲）。
// 落库：flush()（main.ts 定时 ~15s 调一次 + 退出前调一次）把缓冲批量写明细 → 增量重建日桶 →
//       按天节流做保留期清理。落库失败丢弃该批（不毒化重试），不影响反代主流程。
// 读路径：summary/trend/breakdown/topErrors/recent 直接委托仓储。
//
// 缓冲上限兜底：极端情况下（DB 持续失败/超高 QPS）缓冲超 cap 丢最旧，防内存膨胀。

import type { ProxyRequestRecord } from '../domain/observability/proxy-request-log'
import type { MikroOrmRoutingLogRepository } from '../infrastructure/routing-log/mikro-orm-routing-log.repository'
import type {
  RoutingAccountStat,
  RoutingBreakdownDim,
  RoutingBreakdownRow,
  RoutingErrorRow,
  RoutingGranularity,
  RoutingRecentFilter,
  RoutingRecentRow,
  RoutingSummary,
  RoutingTrendPoint,
  RoutingWindow,
} from '../domain/observability/routing-log-record'

export interface RoutingLogServiceOpts {
  /** 明细保留天数（默认 90）。 */
  detailRetentionDays?: number
  /** 日桶保留天数（默认 365）。 */
  rollupRetentionDays?: number
  /** 缓冲上限（默认 5000），超出丢最旧。 */
  bufferCap?: number
  /** 注入时钟（测试用），默认 Date.now。 */
  clock?: () => number
}

/** 本地 YYYY-MM-DD（与 SQLite 'localtime' 同口径，用于保留期/节流）。 */
function localDayKey(ms: number): string {
  const d = new Date(ms)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export class RoutingLogService {
  private readonly repo: MikroOrmRoutingLogRepository
  private readonly detailRetentionDays: number
  private readonly rollupRetentionDays: number
  private readonly bufferCap: number
  private readonly clock: () => number

  private buffer: ProxyRequestRecord[] = []
  private flushing = false
  private lastPurgeDay = ''

  constructor(repo: MikroOrmRoutingLogRepository, opts: RoutingLogServiceOpts = {}) {
    this.repo = repo
    this.detailRetentionDays = Math.max(1, opts.detailRetentionDays ?? 90)
    this.rollupRetentionDays = Math.max(1, opts.rollupRetentionDays ?? 365)
    this.bufferCap = Math.max(100, opts.bufferCap ?? 5000)
    this.clock = opts.clock ?? Date.now
  }

  /** 入队一条记录（同步、非阻塞）。超 cap 丢最旧。 */
  enqueue(rec: ProxyRequestRecord): void {
    this.buffer.push(rec)
    if (this.buffer.length > this.bufferCap) {
      this.buffer.splice(0, this.buffer.length - this.bufferCap)
    }
  }

  /** 当前缓冲待落库条数（诊断用）。 */
  pendingCount(): number {
    return this.buffer.length
  }

  /**
   * 落库：取走当前缓冲 → 批量写明细 → 增量重建日桶 → 按天节流清理保留期。
   * 重入保护：上一次 flush 未完成则直接返回。失败丢弃该批并打印（不重新入队，避免毒化批次反复失败）。
   */
  async flush(): Promise<void> {
    if (this.flushing) return
    if (this.buffer.length === 0) return
    this.flushing = true
    const batch = this.buffer
    this.buffer = []
    try {
      const minTsSec = await this.repo.insertMany(batch)
      if (minTsSec !== null) {
        await this.repo.rebuildRollupsSince(minTsSec)
      }
      await this.maybePurge()
    } catch (err) {
      console.error('[routingLog] flush failed, dropping', batch.length, 'records:', err)
    } finally {
      this.flushing = false
    }
  }

  /** 每个本地自然日首次 flush 时做一次保留期清理（DELETE 走索引，便宜）。 */
  private async maybePurge(): Promise<void> {
    const today = localDayKey(this.clock())
    if (today === this.lastPurgeDay) return
    this.lastPurgeDay = today
    const nowSec = Math.floor(this.clock() / 1000)
    const detailCutoffSec = nowSec - this.detailRetentionDays * 86_400
    const rollupCutoffDate = localDayKey(this.clock() - this.rollupRetentionDays * 86_400_000)
    try {
      await this.repo.purge(detailCutoffSec, rollupCutoffDate)
    } catch (err) {
      console.error('[routingLog] purge failed:', err)
    }
  }

  // ── 查询委托（先 flush 当前缓冲，保证读到最新；flush 重入安全）─────────────────

  async summary(window: RoutingWindow): Promise<RoutingSummary> {
    await this.flush()
    return this.repo.summary(window)
  }

  async trend(
    window: RoutingWindow,
    granularity: RoutingGranularity,
  ): Promise<RoutingTrendPoint[]> {
    await this.flush()
    return this.repo.trend(window, granularity)
  }

  async breakdown(
    window: RoutingWindow,
    dimension: RoutingBreakdownDim,
  ): Promise<RoutingBreakdownRow[]> {
    await this.flush()
    return this.repo.breakdown(window, dimension)
  }

  async topErrors(window: RoutingWindow, limit = 20): Promise<RoutingErrorRow[]> {
    await this.flush()
    return this.repo.topErrors(window, Math.max(1, Math.min(200, limit)))
  }

  async recent(limit = 100, filter: RoutingRecentFilter = {}): Promise<RoutingRecentRow[]> {
    await this.flush()
    return this.repo.recent(Math.max(1, Math.min(1000, limit)), filter)
  }

  /** 按账号聚合统计（供账号池健康页；读前先 flush 保证最新）。 */
  async accountStats(window: RoutingWindow): Promise<RoutingAccountStat[]> {
    await this.flush()
    return this.repo.accountStats(window)
  }

  /** 清空缓冲 + 两表。 */
  async clear(): Promise<void> {
    this.buffer = []
    await this.repo.clearAll()
  }
}
