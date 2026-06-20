// 路由日志（observability v2）· 应用服务（写入侧）。
//
// 持久化唯一源：ProxyRequestLog.persistSink → 本服务 enqueue()，落库到 routing_events + 4 张维度
// 日桶（唯一历史/检索/聚合源）。
//
// 写路径：enqueue（同步入缓冲，映射为 RoutingEvent）→ flush（批量 ingestBatch 单事务落库）。
// flush 由 main.ts 定时 ~15s 调一次 + 退出前调一次。落库失败丢该批（不重入队、不毒化）。

import type { ProxyRequestRecord } from '../domain/observability/proxy-request-log'
import { routingEventFromRecord, type RoutingEvent } from '../domain/observability/routing-event'
import type {
  RoutingAccountStat,
  RoutingBreakdownDim,
  RoutingBreakdownRow,
  RoutingCursor,
  RoutingErrorRow,
  RoutingEventRow,
  RoutingGranularity,
  RoutingSearchFilter,
  RoutingSearchPage,
  RoutingSummary,
  RoutingTrendPoint,
  RoutingWindow,
} from '../domain/observability/routing-query'
import type { MikroOrmRoutingObservabilityRepository } from '../infrastructure/observability/mikro-orm-routing-observability.repository'
import type { UsageEventIngestService } from '../../analytics/application/usage-event-ingest-service'

export interface RoutingObservabilityServiceOpts {
  /** 明细保留天数（默认 90）。 */
  detailRetentionDays?: number
  /** 日桶保留天数（默认 400）。 */
  rollupRetentionDays?: number
  /** 缓冲上限（默认 5000），超出丢最旧。 */
  bufferCap?: number
  /** 注入时钟（测试用），默认 Date.now。 */
  clock?: () => number
}

/** 本地 YYYY-MM-DD（保留期/节流用，与 SQLite localtime 同口径）。 */
function localDayKey(ms: number): string {
  const d = new Date(ms)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export class RoutingObservabilityService {
  private readonly repo: MikroOrmRoutingObservabilityRepository
  private readonly detailRetentionDays: number
  private readonly rollupRetentionDays: number
  private readonly bufferCap: number
  private readonly clock: () => number
  private readonly ingestService: UsageEventIngestService | undefined

  private buffer: RoutingEvent[] = []
  private flushing = false
  private lastPurgeDay = ''

  constructor(
    repo: MikroOrmRoutingObservabilityRepository,
    opts: RoutingObservabilityServiceOpts = {},
    ingestService?: UsageEventIngestService,
  ) {
    this.repo = repo
    this.detailRetentionDays = Math.max(1, opts.detailRetentionDays ?? 90)
    this.rollupRetentionDays = Math.max(1, opts.rollupRetentionDays ?? 400)
    this.bufferCap = Math.max(100, opts.bufferCap ?? 5000)
    this.clock = opts.clock ?? Date.now
    this.ingestService = ingestService
  }

  /** 入队一条 G3 记录（同步、非阻塞，映射为 RoutingEvent）。超 cap 丢最旧。 */
  enqueue(rec: ProxyRequestRecord): void {
    this.buffer.push(routingEventFromRecord(rec))
    if (this.buffer.length > this.bufferCap) {
      this.buffer.splice(0, this.buffer.length - this.bufferCap)
    }
    // 追加写入 analytics 缓冲（同步入内存，不阻塞；定时 flush 批量写 DB）
    if (this.ingestService) {
      this.ingestService.ingestProxyEvent(rec, rec.userAgent ?? '')
    }
  }

  /** 当前缓冲待落库条数（诊断用）。 */
  pendingCount(): number {
    return this.buffer.length
  }

  /**
   * 落库：取走缓冲 → 单事务 ingestBatch（明细 + 4 日桶增量）→ 按天节流清理。
   * 重入保护：上一次 flush 未完成则直接返回。失败丢该批（不重入队，避免毒化批次反复失败）。
   */
  async flush(): Promise<void> {
    if (this.flushing) return
    if (this.buffer.length === 0) return
    this.flushing = true
    const batch = this.buffer
    this.buffer = []
    try {
      await this.repo.ingestBatch(batch)
      await this.maybePurge()
    } catch (err) {
      console.error('[routingObs] flush failed, dropping', batch.length, 'records:', err)
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
      console.error('[routingObs] purge failed:', err)
    }
  }

  /** 清空缓冲 + 全部表。 */
  async clear(): Promise<void> {
    this.buffer = []
    await this.repo.clearAll()
  }

  // ── 查询委托（读前先 flush 当前缓冲，保证读到最新；flush 重入安全）──────────────

  async summary(window: RoutingWindow): Promise<RoutingSummary> {
    await this.flush()
    return this.repo.summary(window)
  }

  async trend(window: RoutingWindow, granularity: RoutingGranularity): Promise<RoutingTrendPoint[]> {
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

  async accountStats(window: RoutingWindow): Promise<RoutingAccountStat[]> {
    await this.flush()
    return this.repo.accountStats(window)
  }

  async search(
    window: RoutingWindow,
    filter: RoutingSearchFilter = {},
    cursor?: RoutingCursor,
    limit = 100,
  ): Promise<RoutingSearchPage> {
    await this.flush()
    return this.repo.search(window, filter, cursor, Math.max(1, Math.min(1000, limit)))
  }

  async detail(id: number): Promise<RoutingEventRow | undefined> {
    await this.flush()
    return this.repo.detail(id)
  }
}
