/**
 * MikroORM(better-sqlite) 写入仓储：路由日志重构后的统一明细 + 4 张日桶（增量 UPSERT）。
 *
 * 写路径核心 ingestBatch(events)：单事务内
 *   1. 批量 INSERT 明细 routing_events；
 *   2. 在内存把 batch 聚合到 4 个维度日桶（platform·combo / model / account / status）；
 *   3. 对每个聚合键做 UPSERT 增量累加（col = col + excluded.col）——把热日成本从
 *      O(当天总量) 降到 O(batch 内不同维度组合数)，取代旧实现的「DELETE + 全量重建当天」。
 *
 * 一致性：明细 INSERT 与日桶 UPSERT 在同一事务，失败整体 ROLLBACK（由上层丢批，不毒化重试），
 * 不会出现「明细写了、日桶没加」的偏差。
 *
 * 全部用原生 SQLite SQL（与 usage 同口径）。读取查询见同类的 summary/trend/breakdown/search 等方法。
 */
import type { EntityManager } from '@mikro-orm/better-sqlite'
import { getEm as defaultGetEm } from '../../../../platform/persistence/database'
import { statusClassOf, type RoutingEvent } from '../../domain/observability/routing-event'
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
} from '../../domain/observability/routing-query'

/* eslint-disable @typescript-eslint/no-explicit-any */

/** 维度 → 明细列/表达式（白名单，防注入）。相比旧版新增 clientKey。 */
const DIM_KEY_EXPR: Record<RoutingBreakdownDim, string> = {
  platform: `COALESCE(NULLIF(platform, ''), '—')`,
  combo: `COALESCE(NULLIF(combo_name, ''), '—')`,
  model: `COALESCE(NULLIF(final_model, ''), '—')`,
  account: `COALESCE(NULLIF(account_id, ''), '—')`,
  clientKey: `COALESCE(NULLIF(client_key_id, ''), '—')`,
  status: `CASE
    WHEN status >= 500 THEN '5xx'
    WHEN status >= 400 THEN '4xx'
    WHEN status >= 300 THEN '3xx'
    WHEN status >= 200 THEN '2xx'
    ELSE 'other' END`,
}

/** statusClass → [lo, hi] 闭区间（other 归一为 <200）。 */
const STATUS_CLASS_RANGE: Record<string, [number, number]> = {
  '2xx': [200, 299],
  '3xx': [300, 399],
  '4xx': [400, 499],
  '5xx': [500, 599],
  other: [0, 199],
}

/** 本地 YYYY-MM-DD（与 SQLite date(ts,'unixepoch','localtime') 同口径）。 */
function localDayKey(tsMs: number): string {
  const d = new Date(tsMs)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

interface DimAgg {
  date: string
  k1: string
  k2: string
  records: number
  success: number
  failed: number
  rateLimited: number
  sumDuration: number
  sumTtfb: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

function emptyAgg(date: string, k1: string, k2: string): DimAgg {
  return {
    date,
    k1,
    k2,
    records: 0,
    success: 0,
    failed: 0,
    rateLimited: 0,
    sumDuration: 0,
    sumTtfb: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  }
}

function accumulate(map: Map<string, DimAgg>, date: string, k1: string, k2: string, ev: RoutingEvent): void {
  const key = `${date}\u0000${k1}\u0000${k2}`
  let agg = map.get(key)
  if (agg === undefined) {
    agg = emptyAgg(date, k1, k2)
    map.set(key, agg)
  }
  agg.records += 1
  if (ev.ok) agg.success += 1
  else agg.failed += 1
  if (ev.status === 429) agg.rateLimited += 1
  agg.sumDuration += ev.durationMs
  agg.sumTtfb += ev.ttfbMs ?? 0
  agg.input += ev.inputTokens ?? 0
  agg.output += ev.outputTokens ?? 0
  agg.cacheRead += ev.cacheReadTokens ?? 0
  agg.cacheWrite += ev.cacheWriteTokens ?? 0
}

export class MikroOrmRoutingObservabilityRepository {
  private readonly getEm: () => EntityManager

  constructor(getEmFn?: () => EntityManager) {
    this.getEm = getEmFn ?? defaultGetEm
  }

  /**
   * 批量摄取：单事务内写明细 + 增量 UPSERT 4 日桶。空数组 no-op。
   * 失败抛出（上层丢批），保证明细与日桶同生同灭。
   */
  async ingestBatch(events: RoutingEvent[]): Promise<void> {
    if (events.length === 0) return
    const conn = this.getEm().getConnection()
    const nowSec = Math.floor(Date.now() / 1000)

    // 维度聚合（platform·combo / model / account / status）。
    const daily = new Map<string, DimAgg>()
    const byModel = new Map<string, DimAgg>()
    const byAccount = new Map<string, DimAgg>()
    const byStatus = new Map<string, DimAgg>()
    for (const ev of events) {
      const date = localDayKey(ev.tsMs)
      accumulate(daily, date, ev.platform ?? '', ev.comboName ?? '', ev)
      accumulate(byModel, date, ev.finalModel ?? ev.requestedModel ?? '', '', ev)
      accumulate(byAccount, date, ev.accountId ?? '', '', ev)
      accumulate(byStatus, date, statusClassOf(ev.status), '', ev)
    }

    await conn.execute('BEGIN')
    try {
      for (const ev of events) {
        await conn.execute(
          `INSERT INTO routing_events (
             seq, ts_ms, ts_sec, method, path, format, platform, action, stream, status, ok,
             error_kind, error_message, duration_ms, ttfb_ms, upstream_ms, attempts, route_hops,
             route_path, combo_name, requested_model, final_model, account_id, client_key_id,
             upstream_endpoint, proxy_id, input_tokens, output_tokens, cache_read_tokens,
             cache_write_tokens, req_bytes, resp_bytes, client_ip, user_agent
           ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            ev.seq,
            ev.tsMs,
            Math.floor(ev.tsMs / 1000),
            ev.method,
            ev.path,
            ev.format,
            ev.platform ?? null,
            ev.action,
            ev.stream ? 1 : 0,
            ev.status,
            ev.ok ? 1 : 0,
            ev.errorKind,
            ev.errorMessage ?? null,
            ev.durationMs,
            ev.ttfbMs ?? null,
            ev.upstreamMs ?? null,
            ev.attempts,
            ev.routeHops ?? null,
            ev.routePath !== undefined ? JSON.stringify(ev.routePath) : null,
            ev.comboName ?? null,
            ev.requestedModel ?? null,
            ev.finalModel ?? null,
            ev.accountId ?? null,
            ev.clientKeyId ?? null,
            ev.upstreamEndpoint ?? null,
            ev.proxyId ?? null,
            ev.inputTokens ?? null,
            ev.outputTokens ?? null,
            ev.cacheReadTokens ?? null,
            ev.cacheWriteTokens ?? null,
            ev.reqBytes ?? null,
            ev.respBytes ?? null,
            ev.clientIp ?? null,
            ev.userAgent ?? null,
          ],
        )
      }

      for (const a of daily.values()) await this.upsertDaily(conn, a, nowSec)
      for (const a of byModel.values()) await this.upsertModel(conn, a, nowSec)
      for (const a of byAccount.values()) await this.upsertAccount(conn, a, nowSec)
      for (const a of byStatus.values()) await this.upsertStatus(conn, a, nowSec)

      await conn.execute('COMMIT')
    } catch (err) {
      await conn.execute('ROLLBACK')
      throw err
    }
  }

  private async upsertDaily(conn: any, a: DimAgg, nowSec: number): Promise<void> {
    await conn.execute(
      `INSERT INTO routing_rollup_daily (
         date, platform, combo_name, records_count, success_count, failed_count,
         sum_duration_ms, sum_ttfb_ms, input_tokens, output_tokens,
         cache_read_tokens, cache_write_tokens, updated_at
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(date, platform, combo_name) DO UPDATE SET
         records_count = records_count + excluded.records_count,
         success_count = success_count + excluded.success_count,
         failed_count = failed_count + excluded.failed_count,
         sum_duration_ms = sum_duration_ms + excluded.sum_duration_ms,
         sum_ttfb_ms = sum_ttfb_ms + excluded.sum_ttfb_ms,
         input_tokens = input_tokens + excluded.input_tokens,
         output_tokens = output_tokens + excluded.output_tokens,
         cache_read_tokens = cache_read_tokens + excluded.cache_read_tokens,
         cache_write_tokens = cache_write_tokens + excluded.cache_write_tokens,
         updated_at = excluded.updated_at`,
      [
        a.date, a.k1, a.k2, a.records, a.success, a.failed,
        a.sumDuration, a.sumTtfb, a.input, a.output, a.cacheRead, a.cacheWrite, nowSec,
      ],
    )
  }

  private async upsertModel(conn: any, a: DimAgg, nowSec: number): Promise<void> {
    await conn.execute(
      `INSERT INTO routing_rollup_model_daily (
         date, model, records_count, success_count, failed_count,
         sum_duration_ms, sum_ttfb_ms, input_tokens, output_tokens,
         cache_read_tokens, cache_write_tokens, updated_at
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(date, model) DO UPDATE SET
         records_count = records_count + excluded.records_count,
         success_count = success_count + excluded.success_count,
         failed_count = failed_count + excluded.failed_count,
         sum_duration_ms = sum_duration_ms + excluded.sum_duration_ms,
         sum_ttfb_ms = sum_ttfb_ms + excluded.sum_ttfb_ms,
         input_tokens = input_tokens + excluded.input_tokens,
         output_tokens = output_tokens + excluded.output_tokens,
         cache_read_tokens = cache_read_tokens + excluded.cache_read_tokens,
         cache_write_tokens = cache_write_tokens + excluded.cache_write_tokens,
         updated_at = excluded.updated_at`,
      [
        a.date, a.k1, a.records, a.success, a.failed,
        a.sumDuration, a.sumTtfb, a.input, a.output, a.cacheRead, a.cacheWrite, nowSec,
      ],
    )
  }

  private async upsertAccount(conn: any, a: DimAgg, nowSec: number): Promise<void> {
    await conn.execute(
      `INSERT INTO routing_rollup_account_daily (
         date, account_id, records_count, success_count, failed_count, rate_limited_count,
         sum_duration_ms, sum_ttfb_ms, input_tokens, output_tokens,
         cache_read_tokens, cache_write_tokens, updated_at
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(date, account_id) DO UPDATE SET
         records_count = records_count + excluded.records_count,
         success_count = success_count + excluded.success_count,
         failed_count = failed_count + excluded.failed_count,
         rate_limited_count = rate_limited_count + excluded.rate_limited_count,
         sum_duration_ms = sum_duration_ms + excluded.sum_duration_ms,
         sum_ttfb_ms = sum_ttfb_ms + excluded.sum_ttfb_ms,
         input_tokens = input_tokens + excluded.input_tokens,
         output_tokens = output_tokens + excluded.output_tokens,
         cache_read_tokens = cache_read_tokens + excluded.cache_read_tokens,
         cache_write_tokens = cache_write_tokens + excluded.cache_write_tokens,
         updated_at = excluded.updated_at`,
      [
        a.date, a.k1, a.records, a.success, a.failed, a.rateLimited,
        a.sumDuration, a.sumTtfb, a.input, a.output, a.cacheRead, a.cacheWrite, nowSec,
      ],
    )
  }

  private async upsertStatus(conn: any, a: DimAgg, nowSec: number): Promise<void> {
    await conn.execute(
      `INSERT INTO routing_rollup_status_daily (
         date, status_class, records_count, sum_duration_ms, sum_ttfb_ms,
         input_tokens, output_tokens, updated_at
       ) VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(date, status_class) DO UPDATE SET
         records_count = records_count + excluded.records_count,
         sum_duration_ms = sum_duration_ms + excluded.sum_duration_ms,
         sum_ttfb_ms = sum_ttfb_ms + excluded.sum_ttfb_ms,
         input_tokens = input_tokens + excluded.input_tokens,
         output_tokens = output_tokens + excluded.output_tokens,
         updated_at = excluded.updated_at`,
      [a.date, a.k1, a.records, a.sumDuration, a.sumTtfb, a.input, a.output, nowSec],
    )
  }

  /** 保留期清理：删早于 cutoffSec 的明细、早于 cutoffDate(YYYY-MM-DD) 的 4 张日桶。 */
  async purge(detailCutoffSec: number, rollupCutoffDate: string): Promise<void> {
    const conn = this.getEm().getConnection()
    await conn.execute('DELETE FROM routing_events WHERE ts_sec < ?', [detailCutoffSec])
    await conn.execute('DELETE FROM routing_rollup_daily WHERE date < ?', [rollupCutoffDate])
    await conn.execute('DELETE FROM routing_rollup_model_daily WHERE date < ?', [rollupCutoffDate])
    await conn.execute('DELETE FROM routing_rollup_account_daily WHERE date < ?', [rollupCutoffDate])
    await conn.execute('DELETE FROM routing_rollup_status_daily WHERE date < ?', [rollupCutoffDate])
  }

  /** 清空明细 + 4 张日桶（「清空日志」动作）。 */
  async clearAll(): Promise<void> {
    const conn = this.getEm().getConnection()
    await conn.execute('BEGIN')
    try {
      await conn.execute('DELETE FROM routing_events')
      await conn.execute('DELETE FROM routing_rollup_daily')
      await conn.execute('DELETE FROM routing_rollup_model_daily')
      await conn.execute('DELETE FROM routing_rollup_account_daily')
      await conn.execute('DELETE FROM routing_rollup_status_daily')
      await conn.execute('COMMIT')
    } catch (err) {
      await conn.execute('ROLLBACK')
      throw err
    }
  }

  // ── 查询 ───────────────────────────────────────────────────────────────────

  async summary(window: RoutingWindow): Promise<RoutingSummary> {
    const conn = this.getEm().getConnection()
    const row =
      ((await conn.execute(
        `SELECT
         COUNT(*) AS requests,
         COALESCE(SUM(CASE WHEN ok = 1 THEN 1 ELSE 0 END), 0) AS success,
         COALESCE(SUM(CASE WHEN ok = 1 THEN 0 ELSE 1 END), 0) AS failed,
         COALESCE(SUM(duration_ms), 0) AS sum_duration,
         COALESCE(SUM(ttfb_ms), 0) AS sum_ttfb,
         COUNT(ttfb_ms) AS ttfb_count,
         COALESCE(SUM(input_tokens), 0) AS input_tokens,
         COALESCE(SUM(output_tokens), 0) AS output_tokens,
         COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
         COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens,
         COALESCE(SUM(CASE WHEN route_hops > 1 THEN 1 ELSE 0 END), 0) AS fallback_requests,
         COALESCE(SUM(CASE WHEN combo_name IS NOT NULL AND combo_name <> '' THEN 1 ELSE 0 END), 0) AS combo_requests
       FROM routing_events
       WHERE ts_sec >= ? AND ts_sec <= ?`,
        [window.startSec, window.endSec],
        'get',
      )) as any) ?? {}

    const requests = Number(row.requests ?? 0)
    const success = Number(row.success ?? 0)
    const failed = Number(row.failed ?? 0)
    const sumDuration = Number(row.sum_duration ?? 0)
    const sumTtfb = Number(row.sum_ttfb ?? 0)
    const ttfbCount = Number(row.ttfb_count ?? 0)
    const inputTokens = Number(row.input_tokens ?? 0)
    const outputTokens = Number(row.output_tokens ?? 0)
    const cacheReadTokens = Number(row.cache_read_tokens ?? 0)
    const cacheWriteTokens = Number(row.cache_write_tokens ?? 0)

    return {
      requests,
      success,
      failed,
      successRate: requests === 0 ? 0 : success / requests,
      errorRate: requests === 0 ? 0 : failed / requests,
      avgDurationMs: requests === 0 ? 0 : Math.round(sumDuration / requests),
      p95DurationMs: await this.p95Duration(window, requests),
      avgTtfbMs: ttfbCount === 0 ? 0 : Math.round(sumTtfb / ttfbCount),
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      totalTokens: inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens,
      fallbackRequests: Number(row.fallback_requests ?? 0),
      comboRequests: Number(row.combo_requests ?? 0),
      peakRpm: await this.peakRpm(window),
    }
  }

  /** 峰值 RPM：按自然分钟桶（ts_sec/60）计数后取最大值。 */
  private async peakRpm(window: RoutingWindow): Promise<number> {
    const conn = this.getEm().getConnection()
    const row =
      ((await conn.execute(
        `SELECT COALESCE(MAX(cnt), 0) AS peak FROM (
           SELECT COUNT(*) AS cnt FROM routing_events
           WHERE ts_sec >= ? AND ts_sec <= ?
           GROUP BY ts_sec / 60
         )`,
        [window.startSec, window.endSec],
        'get',
      )) as any) ?? {}
    return Number(row.peak ?? 0)
  }

  /** 最近秩 P95（nearest-rank）：rank=ceil(0.95*n)，取排序后第 rank 条（明细）。 */
  private async p95Duration(window: RoutingWindow, count: number): Promise<number> {
    if (count <= 0) return 0
    const offset = Math.min(count - 1, Math.max(0, Math.ceil(0.95 * count) - 1))
    const conn = this.getEm().getConnection()
    const row =
      ((await conn.execute(
        `SELECT duration_ms FROM routing_events
       WHERE ts_sec >= ? AND ts_sec <= ?
       ORDER BY duration_ms ASC LIMIT 1 OFFSET ?`,
        [window.startSec, window.endSec, offset],
        'get',
      )) as any) ?? {}
    return Number(row.duration_ms ?? 0)
  }

  async trend(window: RoutingWindow, granularity: RoutingGranularity): Promise<RoutingTrendPoint[]> {
    const conn = this.getEm().getConnection()
    let rows: any[]
    if (granularity === 'hour') {
      rows = (await conn.execute(
        `SELECT strftime('%Y-%m-%d %H:00', ts_sec, 'unixepoch', 'localtime') AS date,
           COUNT(*) AS requests,
           COALESCE(SUM(CASE WHEN ok = 1 THEN 1 ELSE 0 END), 0) AS success,
           COALESCE(SUM(CASE WHEN ok = 1 THEN 0 ELSE 1 END), 0) AS failed,
           COALESCE(SUM(duration_ms), 0) AS sum_duration,
           COALESCE(SUM(input_tokens), 0) AS input_tokens,
           COALESCE(SUM(output_tokens), 0) AS output_tokens
         FROM routing_events
         WHERE ts_sec >= ? AND ts_sec <= ?
         GROUP BY date ORDER BY date ASC`,
        [window.startSec, window.endSec],
        'all',
      )) as any[]
    } else {
      // day：走日桶（明细被清理后仍可看长期趋势）。
      rows = (await conn.execute(
        `SELECT date,
           COALESCE(SUM(records_count), 0) AS requests,
           COALESCE(SUM(success_count), 0) AS success,
           COALESCE(SUM(failed_count), 0) AS failed,
           COALESCE(SUM(sum_duration_ms), 0) AS sum_duration,
           COALESCE(SUM(input_tokens), 0) AS input_tokens,
           COALESCE(SUM(output_tokens), 0) AS output_tokens
         FROM routing_rollup_daily
         WHERE date >= date(?, 'unixepoch', 'localtime') AND date <= date(?, 'unixepoch', 'localtime')
         GROUP BY date ORDER BY date ASC`,
        [window.startSec, window.endSec],
        'all',
      )) as any[]
    }
    return (rows ?? []).map((r: any) => {
      const requests = Number(r.requests ?? 0)
      const sumDuration = Number(r.sum_duration ?? 0)
      return {
        date: r.date ?? '',
        requests,
        success: Number(r.success ?? 0),
        failed: Number(r.failed ?? 0),
        avgDurationMs: requests === 0 ? 0 : Math.round(sumDuration / requests),
        inputTokens: Number(r.input_tokens ?? 0),
        outputTokens: Number(r.output_tokens ?? 0),
      }
    })
  }

  async breakdown(window: RoutingWindow, dimension: RoutingBreakdownDim): Promise<RoutingBreakdownRow[]> {
    const keyExpr = DIM_KEY_EXPR[dimension]
    const conn = this.getEm().getConnection()
    const rows = (await conn.execute(
      `SELECT ${keyExpr} AS key,
         COUNT(*) AS requests,
         COALESCE(SUM(CASE WHEN ok = 1 THEN 1 ELSE 0 END), 0) AS success,
         COALESCE(SUM(CASE WHEN ok = 1 THEN 0 ELSE 1 END), 0) AS failed,
         COALESCE(SUM(duration_ms), 0) AS sum_duration,
         COALESCE(SUM(input_tokens), 0) AS input_tokens,
         COALESCE(SUM(output_tokens), 0) AS output_tokens
       FROM routing_events
       WHERE ts_sec >= ? AND ts_sec <= ?
       GROUP BY key ORDER BY requests DESC, key ASC`,
      [window.startSec, window.endSec],
      'all',
    )) as any[]

    const grandTotal = (rows ?? []).reduce((s, r) => s + Number(r.requests ?? 0), 0)
    return (rows ?? []).map((r: any) => {
      const requests = Number(r.requests ?? 0)
      const success = Number(r.success ?? 0)
      const sumDuration = Number(r.sum_duration ?? 0)
      return {
        key: r.key ?? '—',
        requests,
        success,
        failed: Number(r.failed ?? 0),
        successRate: requests === 0 ? 0 : success / requests,
        avgDurationMs: requests === 0 ? 0 : Math.round(sumDuration / requests),
        inputTokens: Number(r.input_tokens ?? 0),
        outputTokens: Number(r.output_tokens ?? 0),
        shareRatio: grandTotal === 0 ? 0 : requests / grandTotal,
      }
    })
  }

  async topErrors(window: RoutingWindow, limit: number): Promise<RoutingErrorRow[]> {
    const conn = this.getEm().getConnection()
    const rows = (await conn.execute(
      `SELECT error_kind AS error_kind, error_message AS message,
         COUNT(*) AS count, MAX(ts_ms) AS last_ts_ms,
         (SELECT status FROM routing_events t2
            WHERE t2.error_message IS t1.error_message AND t2.ts_sec >= ? AND t2.ts_sec <= ?
            ORDER BY t2.ts_ms DESC LIMIT 1) AS last_status
       FROM routing_events t1
       WHERE ok = 0 AND ts_sec >= ? AND ts_sec <= ?
       GROUP BY error_kind, error_message
       ORDER BY count DESC, last_ts_ms DESC LIMIT ?`,
      [window.startSec, window.endSec, window.startSec, window.endSec, limit],
      'all',
    )) as any[]
    return (rows ?? []).map((r: any) => ({
      errorKind: r.error_kind ?? 'internal',
      message: r.message ?? '',
      count: Number(r.count ?? 0),
      lastStatus: Number(r.last_status ?? 0),
      lastTsMs: Number(r.last_ts_ms ?? 0),
    }))
  }

  async accountStats(window: RoutingWindow): Promise<RoutingAccountStat[]> {
    const conn = this.getEm().getConnection()
    const rows = (await conn.execute(
      `SELECT account_id AS account_id,
         COUNT(*) AS requests,
         COALESCE(SUM(CASE WHEN ok = 1 THEN 1 ELSE 0 END), 0) AS success,
         COALESCE(SUM(CASE WHEN ok = 1 THEN 0 ELSE 1 END), 0) AS failed,
         COALESCE(SUM(CASE WHEN status = 429 THEN 1 ELSE 0 END), 0) AS rate_limited,
         COALESCE(SUM(duration_ms), 0) AS sum_duration,
         COALESCE(SUM(input_tokens), 0) AS input_tokens,
         COALESCE(SUM(output_tokens), 0) AS output_tokens,
         COALESCE(SUM(cache_read_tokens), 0) + COALESCE(SUM(cache_write_tokens), 0) AS cache_tokens,
         MAX(ts_ms) AS last_ts_ms
       FROM routing_events
       WHERE ts_sec >= ? AND ts_sec <= ? AND account_id IS NOT NULL AND account_id <> ''
       GROUP BY account_id`,
      [window.startSec, window.endSec],
      'all',
    )) as any[]
    const peakByAccount = await this.peakRpmByAccount(window)
    return (rows ?? []).map((r: any) => {
      const requests = Number(r.requests ?? 0)
      const sumDuration = Number(r.sum_duration ?? 0)
      const accountId = String(r.account_id)
      return {
        accountId,
        requests,
        success: Number(r.success ?? 0),
        failed: Number(r.failed ?? 0),
        rateLimited: Number(r.rate_limited ?? 0),
        avgDurationMs: requests === 0 ? 0 : Math.round(sumDuration / requests),
        peakRpm: peakByAccount.get(accountId) ?? 0,
        inputTokens: Number(r.input_tokens ?? 0),
        outputTokens: Number(r.output_tokens ?? 0),
        cacheTokens: Number(r.cache_tokens ?? 0),
        lastTsMs: Number(r.last_ts_ms ?? 0),
      }
    })
  }

  private async peakRpmByAccount(window: RoutingWindow): Promise<Map<string, number>> {
    const conn = this.getEm().getConnection()
    const rows = (await conn.execute(
      `SELECT account_id, MAX(cnt) AS peak FROM (
         SELECT account_id, COUNT(*) AS cnt FROM routing_events
         WHERE ts_sec >= ? AND ts_sec <= ? AND account_id IS NOT NULL AND account_id <> ''
         GROUP BY account_id, ts_sec / 60
       ) GROUP BY account_id`,
      [window.startSec, window.endSec],
      'all',
    )) as any[]
    return new Map((rows ?? []).map((r: any) => [String(r.account_id), Number(r.peak ?? 0)]))
  }

  /**
   * 明细检索（取代旧 recent）：窗口 + 全维度过滤 + 关键字 LIKE + keyset 分页（按 ts_ms,id 降序）。
   * 取 limit+1 行判断是否还有下一页；nextCursor 指向下一页起点（上一页最后一行的 ts_ms,id）。
   */
  async search(
    window: RoutingWindow,
    filter: RoutingSearchFilter,
    cursor: RoutingCursor | undefined,
    limit: number,
  ): Promise<RoutingSearchPage> {
    const conn = this.getEm().getConnection()
    const where: string[] = ['ts_sec >= ?', 'ts_sec <= ?']
    const params: unknown[] = [window.startSec, window.endSec]
    if (filter.okOnly) where.push('ok = 1')
    if (filter.failedOnly) where.push('ok = 0')
    if (filter.platform) {
      where.push('platform = ?')
      params.push(filter.platform)
    }
    if (filter.comboName) {
      where.push('combo_name = ?')
      params.push(filter.comboName)
    }
    if (filter.model) {
      where.push('final_model = ?')
      params.push(filter.model)
    }
    if (filter.accountId) {
      where.push('account_id = ?')
      params.push(filter.accountId)
    }
    if (filter.clientKeyId) {
      where.push('client_key_id = ?')
      params.push(filter.clientKeyId)
    }
    if (filter.errorKind) {
      where.push('error_kind = ?')
      params.push(filter.errorKind)
    }
    if (filter.statusClass) {
      const range = STATUS_CLASS_RANGE[filter.statusClass]
      if (range) {
        where.push('status >= ? AND status <= ?')
        params.push(range[0], range[1])
      }
    }
    if (filter.keyword && filter.keyword.trim() !== '') {
      const kw = `%${filter.keyword.trim()}%`
      where.push(
        '(path LIKE ? OR final_model LIKE ? OR requested_model LIKE ? OR error_message LIKE ?)',
      )
      params.push(kw, kw, kw, kw)
    }
    if (cursor) {
      where.push('(ts_ms < ? OR (ts_ms = ? AND id < ?))')
      params.push(cursor.tsMs, cursor.tsMs, cursor.id)
    }
    params.push(limit + 1)
    const rows = (await conn.execute(
      `SELECT * FROM routing_events
       WHERE ${where.join(' AND ')}
       ORDER BY ts_ms DESC, id DESC LIMIT ?`,
      params,
      'all',
    )) as any[]

    const mapped = (rows ?? []).map((r) => this.mapEventRow(r))
    if (mapped.length > limit) {
      const page = mapped.slice(0, limit)
      const last = page[page.length - 1]!
      return { rows: page, nextCursor: { tsMs: last.tsMs, id: last.id } }
    }
    return { rows: mapped }
  }

  /** 单条明细详情（按主键 id）。 */
  async detail(id: number): Promise<RoutingEventRow | undefined> {
    const conn = this.getEm().getConnection()
    const row = (await conn.execute(
      `SELECT * FROM routing_events WHERE id = ? LIMIT 1`,
      [id],
      'get',
    )) as any
    return row ? this.mapEventRow(row) : undefined
  }

  /** db row → RoutingEventRow（含 id + 新字段；route_path JSON 反序列化）。 */
  private mapEventRow(r: any): RoutingEventRow {
    const row: RoutingEventRow = {
      id: Number(r.id ?? 0),
      seq: Number(r.seq ?? 0),
      tsMs: Number(r.ts_ms ?? 0),
      method: r.method ?? '',
      path: r.path ?? '',
      format: r.format ?? '',
      action: r.action ?? '',
      stream: Number(r.stream ?? 0) === 1,
      status: Number(r.status ?? 0),
      ok: Number(r.ok ?? 0) === 1,
      errorKind: r.error_kind ?? 'none',
      durationMs: Number(r.duration_ms ?? 0),
      attempts: Number(r.attempts ?? 0),
    }
    if (r.platform != null) row.platform = r.platform
    if (r.error_message != null) row.errorMessage = r.error_message
    if (r.ttfb_ms != null) row.ttfbMs = Number(r.ttfb_ms)
    if (r.upstream_ms != null) row.upstreamMs = Number(r.upstream_ms)
    if (r.route_hops != null) row.routeHops = Number(r.route_hops)
    if (r.route_path != null) {
      try {
        const parsed = JSON.parse(r.route_path)
        if (Array.isArray(parsed)) row.routePath = parsed as string[]
      } catch {
        /* 损坏 JSON 忽略 */
      }
    }
    if (r.combo_name != null) row.comboName = r.combo_name
    if (r.requested_model != null) row.requestedModel = r.requested_model
    if (r.final_model != null) row.finalModel = r.final_model
    if (r.account_id != null) row.accountId = r.account_id
    if (r.client_key_id != null) row.clientKeyId = r.client_key_id
    if (r.upstream_endpoint != null) row.upstreamEndpoint = r.upstream_endpoint
    if (r.proxy_id != null) row.proxyId = r.proxy_id
    if (r.input_tokens != null) row.inputTokens = Number(r.input_tokens)
    if (r.output_tokens != null) row.outputTokens = Number(r.output_tokens)
    if (r.cache_read_tokens != null) row.cacheReadTokens = Number(r.cache_read_tokens)
    if (r.cache_write_tokens != null) row.cacheWriteTokens = Number(r.cache_write_tokens)
    if (r.req_bytes != null) row.reqBytes = Number(r.req_bytes)
    if (r.resp_bytes != null) row.respBytes = Number(r.resp_bytes)
    if (r.client_ip != null) row.clientIp = r.client_ip
    if (r.user_agent != null) row.userAgent = r.user_agent
    return row
  }
}
