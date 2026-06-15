/**
 * MikroORM(better-sqlite) 实现：路由日志分析的明细落库 + 日桶 rollup + 多维查询。
 * 全部用原生 SQLite SQL（strftime/unixepoch/CASE），不走 ORM DSL（与 usage 同口径，需要 SQLite 专有函数）。
 *
 * 查询窗口为 epoch 秒闭区间（RoutingWindow），由渲染层时间选择器给出：
 *   - summary / breakdown / topErrors / recent / trend(hour) 走明细表 routing_request_logs（精确秒边界）；
 *   - trend(day) 走日桶 routing_daily_rollups（明细被清理后仍可看长期趋势）。
 *
 * 增量 rollup：落库后按 minTsSec 重建「该时刻起涉及到的日期」——DELETE 这些 date + 从明细 GROUP BY 重插，
 * 比 minTsSec 更早的旧日桶保持不动（即便明细已过保留期被清理）。
 */
import type { EntityManager } from '@mikro-orm/better-sqlite'
import { getEm as defaultGetEm } from '../../../../platform/persistence/database'
import type { ProxyRequestRecord } from '../../domain/observability/proxy-request-log'
import type {
  RoutingAccountStat,
  RoutingBreakdownDim,
  RoutingBreakdownRow,
  RoutingErrorRow,
  RoutingRecentFilter,
  RoutingRecentRow,
  RoutingSummary,
  RoutingTrendPoint,
  RoutingWindow,
} from '../../domain/observability/routing-log-record'

/* eslint-disable @typescript-eslint/no-explicit-any */

/** 维度 → 明细列/表达式（白名单，防注入）。 */
const DIM_KEY_EXPR: Record<RoutingBreakdownDim, string> = {
  platform: `COALESCE(NULLIF(platform, ''), '—')`,
  combo: `COALESCE(NULLIF(combo_name, ''), '—')`,
  model: `COALESCE(NULLIF(final_model, ''), '—')`,
  account: `COALESCE(NULLIF(account_id, ''), '—')`,
  status: `CASE
    WHEN status >= 500 THEN '5xx'
    WHEN status >= 400 THEN '4xx'
    WHEN status >= 300 THEN '3xx'
    WHEN status >= 200 THEN '2xx'
    ELSE 'other' END`,
}

export class MikroOrmRoutingLogRepository {
  private readonly getEm: () => EntityManager

  constructor(getEmFn?: () => EntityManager) {
    this.getEm = getEmFn ?? defaultGetEm
  }

  // ── 写入 ───────────────────────────────────────────────────────────────────

  /** 批量插入明细（单事务）。空数组 no-op。返回 batch 内最小 tsSec（供增量 rollup）；空返回 null。 */
  async insertMany(records: ProxyRequestRecord[]): Promise<number | null> {
    if (records.length === 0) return null
    const conn = this.getEm().getConnection()
    let minTsSec = Number.POSITIVE_INFINITY
    await conn.execute('BEGIN')
    try {
      for (const r of records) {
        const tsSec = Math.floor(r.tsMs / 1000)
        if (tsSec < minTsSec) minTsSec = tsSec
        await conn.execute(
          `INSERT INTO routing_request_logs (
             seq, ts_ms, ts_sec, method, path, format, platform, action, stream, status, ok,
             duration_ms, attempts, account_id, client_key_id, combo_name, requested_model,
             final_model, route_hops, route_path, input_tokens, output_tokens,
             cache_read_tokens, cache_write_tokens, error_message
           ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            r.seq,
            r.tsMs,
            tsSec,
            r.method,
            r.path,
            r.format,
            r.platform ?? null,
            r.action,
            r.stream ? 1 : 0,
            r.status,
            r.ok ? 1 : 0,
            r.durationMs,
            r.attempts,
            r.accountId ?? null,
            r.clientKeyId ?? null,
            r.comboName ?? null,
            r.requestedModel ?? null,
            r.finalModel ?? null,
            r.routeHops ?? null,
            r.routePath !== undefined ? JSON.stringify(r.routePath) : null,
            r.inputTokens ?? null,
            r.outputTokens ?? null,
            r.cacheReadTokens ?? null,
            r.cacheWriteTokens ?? null,
            r.errorMessage ?? null,
          ],
        )
      }
      await conn.execute('COMMIT')
    } catch (err) {
      await conn.execute('ROLLBACK')
      throw err
    }
    return Number.isFinite(minTsSec) ? minTsSec : null
  }

  /** 增量重建：DELETE 自 minTsSec 起涉及到的日期日桶，再从明细 GROUP BY 重插（单事务）。 */
  async rebuildRollupsSince(minTsSec: number): Promise<void> {
    const conn = this.getEm().getConnection()
    await conn.execute('BEGIN')
    try {
      await conn.execute(
        `DELETE FROM routing_daily_rollups WHERE date IN (
           SELECT DISTINCT date(ts_sec, 'unixepoch', 'localtime')
           FROM routing_request_logs WHERE ts_sec >= ?
         )`,
        [minTsSec],
      )
      await conn.execute(
        `INSERT INTO routing_daily_rollups (
           date, platform, combo_name, records_count, success_count, failed_count,
           sum_duration_ms, input_tokens, output_tokens, updated_at
         )
         SELECT
           date(ts_sec, 'unixepoch', 'localtime'),
           COALESCE(platform, ''),
           COALESCE(combo_name, ''),
           COUNT(*),
           COALESCE(SUM(CASE WHEN ok = 1 THEN 1 ELSE 0 END), 0),
           COALESCE(SUM(CASE WHEN ok = 1 THEN 0 ELSE 1 END), 0),
           COALESCE(SUM(duration_ms), 0),
           COALESCE(SUM(input_tokens), 0),
           COALESCE(SUM(output_tokens), 0),
           CAST(strftime('%s', 'now') AS INTEGER)
         FROM routing_request_logs
         WHERE ts_sec >= ?
         GROUP BY 1, 2, 3`,
        [minTsSec],
      )
      await conn.execute('COMMIT')
    } catch (err) {
      await conn.execute('ROLLBACK')
      throw err
    }
  }

  /** 清空两表（「清空日志」动作）。 */
  async clearAll(): Promise<void> {
    const conn = this.getEm().getConnection()
    await conn.execute('BEGIN')
    try {
      await conn.execute('DELETE FROM routing_request_logs')
      await conn.execute('DELETE FROM routing_daily_rollups')
      await conn.execute('COMMIT')
    } catch (err) {
      await conn.execute('ROLLBACK')
      throw err
    }
  }

  /** 保留期清理：删早于 cutoffSec 的明细、早于 cutoffDate(YYYY-MM-DD) 的日桶。 */
  async purge(detailCutoffSec: number, rollupCutoffDate: string): Promise<void> {
    const conn = this.getEm().getConnection()
    await conn.execute('DELETE FROM routing_request_logs WHERE ts_sec < ?', [detailCutoffSec])
    await conn.execute('DELETE FROM routing_daily_rollups WHERE date < ?', [rollupCutoffDate])
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
         COALESCE(SUM(input_tokens), 0) AS input_tokens,
         COALESCE(SUM(output_tokens), 0) AS output_tokens,
         COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
         COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens,
         COALESCE(SUM(CASE WHEN route_hops > 1 THEN 1 ELSE 0 END), 0) AS fallback_requests,
         COALESCE(SUM(CASE WHEN combo_name IS NOT NULL AND combo_name <> '' THEN 1 ELSE 0 END), 0) AS combo_requests
       FROM routing_request_logs
       WHERE ts_sec >= ? AND ts_sec <= ?`,
        [window.startSec, window.endSec],
        'get',
      )) as any) ?? {}

    const requests = Number(row.requests ?? 0)
    const success = Number(row.success ?? 0)
    const failed = Number(row.failed ?? 0)
    const sumDuration = Number(row.sum_duration ?? 0)
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

  /** 峰值 RPM：按自然分钟桶（ts_sec/60）计数后取最大值（窗口内无数据为 0）。 */
  private async peakRpm(window: RoutingWindow): Promise<number> {
    const conn = this.getEm().getConnection()
    const row =
      ((await conn.execute(
        `SELECT COALESCE(MAX(cnt), 0) AS peak FROM (
           SELECT COUNT(*) AS cnt
           FROM routing_request_logs
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
        `SELECT duration_ms FROM routing_request_logs
       WHERE ts_sec >= ? AND ts_sec <= ?
       ORDER BY duration_ms ASC
       LIMIT 1 OFFSET ?`,
        [window.startSec, window.endSec, offset],
        'get',
      )) as any) ?? {}
    return Number(row.duration_ms ?? 0)
  }

  async trend(window: RoutingWindow, granularity: 'hour' | 'day'): Promise<RoutingTrendPoint[]> {
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
         FROM routing_request_logs
         WHERE ts_sec >= ? AND ts_sec <= ?
         GROUP BY date ORDER BY date ASC`,
        [window.startSec, window.endSec],
        'all',
      )) as any[]
    } else {
      rows = (await conn.execute(
        `SELECT date,
           COALESCE(SUM(records_count), 0) AS requests,
           COALESCE(SUM(success_count), 0) AS success,
           COALESCE(SUM(failed_count), 0) AS failed,
           COALESCE(SUM(sum_duration_ms), 0) AS sum_duration,
           COALESCE(SUM(input_tokens), 0) AS input_tokens,
           COALESCE(SUM(output_tokens), 0) AS output_tokens
         FROM routing_daily_rollups
         WHERE date >= date(?, 'unixepoch', 'localtime') AND date <= date(?, 'unixepoch', 'localtime')
         GROUP BY date ORDER BY date ASC`,
        [window.startSec, window.endSec],
        'all',
      )) as any[]
    }
    return (rows ?? []).map((row: any) => {
      const requests = Number(row.requests ?? 0)
      const sumDuration = Number(row.sum_duration ?? 0)
      return {
        date: row.date ?? '',
        requests,
        success: Number(row.success ?? 0),
        failed: Number(row.failed ?? 0),
        avgDurationMs: requests === 0 ? 0 : Math.round(sumDuration / requests),
        inputTokens: Number(row.input_tokens ?? 0),
        outputTokens: Number(row.output_tokens ?? 0),
      }
    })
  }

  async breakdown(
    window: RoutingWindow,
    dimension: RoutingBreakdownDim,
  ): Promise<RoutingBreakdownRow[]> {
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
       FROM routing_request_logs
       WHERE ts_sec >= ? AND ts_sec <= ?
       GROUP BY key
       ORDER BY requests DESC, key ASC`,
      [window.startSec, window.endSec],
      'all',
    )) as any[]

    const grandTotal = (rows ?? []).reduce((s, r) => s + Number(r.requests ?? 0), 0)
    return (rows ?? []).map((row: any) => {
      const requests = Number(row.requests ?? 0)
      const success = Number(row.success ?? 0)
      const sumDuration = Number(row.sum_duration ?? 0)
      return {
        key: row.key ?? '—',
        requests,
        success,
        failed: Number(row.failed ?? 0),
        successRate: requests === 0 ? 0 : success / requests,
        avgDurationMs: requests === 0 ? 0 : Math.round(sumDuration / requests),
        inputTokens: Number(row.input_tokens ?? 0),
        outputTokens: Number(row.output_tokens ?? 0),
        shareRatio: grandTotal === 0 ? 0 : requests / grandTotal,
      }
    })
  }

  async topErrors(window: RoutingWindow, limit: number): Promise<RoutingErrorRow[]> {
    const conn = this.getEm().getConnection()
    const rows = (await conn.execute(
      `SELECT error_message AS message,
         COUNT(*) AS count,
         MAX(ts_ms) AS last_ts_ms,
         (SELECT status FROM routing_request_logs t2
            WHERE t2.error_message = t1.error_message AND t2.ts_sec >= ? AND t2.ts_sec <= ?
            ORDER BY t2.ts_ms DESC LIMIT 1) AS last_status
       FROM routing_request_logs t1
       WHERE ok = 0 AND error_message IS NOT NULL AND error_message <> ''
         AND ts_sec >= ? AND ts_sec <= ?
       GROUP BY error_message
       ORDER BY count DESC, last_ts_ms DESC
       LIMIT ?`,
      [window.startSec, window.endSec, window.startSec, window.endSec, limit],
      'all',
    )) as any[]
    return (rows ?? []).map((row: any) => ({
      message: row.message ?? '',
      count: Number(row.count ?? 0),
      lastStatus: Number(row.last_status ?? 0),
      lastTsMs: Number(row.last_ts_ms ?? 0),
    }))
  }

  /** 按账号聚合（窗口内）：请求/成功/失败次数 + 平均延迟 + 最近请求时刻。供账号池健康页。 */
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
       FROM routing_request_logs
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

  /** 每账号峰值 RPM：先按 (account_id, 分钟桶) 计数，再按账号取最大；返回 accountId→peak。 */
  private async peakRpmByAccount(window: RoutingWindow): Promise<Map<string, number>> {
    const conn = this.getEm().getConnection()
    const rows = (await conn.execute(
      `SELECT account_id, MAX(cnt) AS peak FROM (
         SELECT account_id, COUNT(*) AS cnt
         FROM routing_request_logs
         WHERE ts_sec >= ? AND ts_sec <= ? AND account_id IS NOT NULL AND account_id <> ''
         GROUP BY account_id, ts_sec / 60
       ) GROUP BY account_id`,
      [window.startSec, window.endSec],
      'all',
    )) as any[]
    return new Map((rows ?? []).map((r: any) => [String(r.account_id), Number(r.peak ?? 0)]))
  }

  async recent(limit: number, filter: RoutingRecentFilter = {}): Promise<RoutingRecentRow[]> {
    const conn = this.getEm().getConnection()
    const where: string[] = []
    const params: unknown[] = []
    if (filter.okOnly) where.push('ok = 1')
    if (filter.failedOnly) where.push('ok = 0')
    if (filter.platform !== undefined && filter.platform !== '') {
      where.push('platform = ?')
      params.push(filter.platform)
    }
    if (filter.comboName !== undefined && filter.comboName !== '') {
      where.push('combo_name = ?')
      params.push(filter.comboName)
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
    params.push(limit)
    const rows = (await conn.execute(
      `SELECT seq, ts_ms, method, path, format, platform, action, stream, status, ok,
         duration_ms, attempts, account_id, client_key_id, combo_name, requested_model,
         final_model, route_hops, route_path, input_tokens, output_tokens,
         cache_read_tokens, cache_write_tokens, error_message
       FROM routing_request_logs
       ${whereSql}
       ORDER BY ts_ms DESC, id DESC
       LIMIT ?`,
      params,
      'all',
    )) as any[]
    return (rows ?? []).map((r: any) => {
      const row: RoutingRecentRow = {
        seq: Number(r.seq ?? 0),
        tsMs: Number(r.ts_ms ?? 0),
        method: r.method ?? '',
        path: r.path ?? '',
        format: r.format ?? '',
        action: r.action ?? '',
        stream: Number(r.stream ?? 0) === 1,
        status: Number(r.status ?? 0),
        ok: Number(r.ok ?? 0) === 1,
        durationMs: Number(r.duration_ms ?? 0),
        attempts: Number(r.attempts ?? 0),
      }
      if (r.platform != null) row.platform = r.platform
      if (r.account_id != null) row.accountId = r.account_id
      if (r.client_key_id != null) row.clientKeyId = r.client_key_id
      if (r.combo_name != null) row.comboName = r.combo_name
      if (r.requested_model != null) row.requestedModel = r.requested_model
      if (r.final_model != null) row.finalModel = r.final_model
      if (r.route_hops != null) row.routeHops = Number(r.route_hops)
      if (r.route_path != null) {
        try {
          const parsed = JSON.parse(r.route_path)
          if (Array.isArray(parsed)) row.routePath = parsed as string[]
        } catch {
          // 损坏的 JSON 忽略 routePath
        }
      }
      if (r.input_tokens != null) row.inputTokens = Number(r.input_tokens)
      if (r.output_tokens != null) row.outputTokens = Number(r.output_tokens)
      if (r.cache_read_tokens != null) row.cacheReadTokens = Number(r.cache_read_tokens)
      if (r.cache_write_tokens != null) row.cacheWriteTokens = Number(r.cache_write_tokens)
      if (r.error_message != null) row.errorMessage = r.error_message
      return row
    })
  }
}
