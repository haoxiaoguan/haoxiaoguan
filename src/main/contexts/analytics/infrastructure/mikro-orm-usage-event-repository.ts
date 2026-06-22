/**
 * usage_events 仓储：写入（双源 upsert + 去重）+ 读取（聚合查询）。
 *
 * 写入：
 *   - insertProxyEvent：代理源直接 INSERT（第一手实时数据，不去重）
 *   - findDuplicateForSession：session 源写入前去重查询
 *   - insertSessionEvents：逐条去重后批量插入
 *
 * 读取：summary / trend / agentBreakdown / modelBreakdown / search
 * 全部走 raw SQL（参照 routing-observability repository 模式）。
 */
import type { EntityManager } from '@mikro-orm/better-sqlite'
import { getEm as defaultGetEm } from '../../../platform/persistence/database'
import { UsageEventEntity } from './usage-event.entity'
import type {
  UsageEvent,
  UsageEventWindow,
  UsageEventGranularity,
  UsageEventTrendMetric,
  UsageEventSummary,
  UsageEventTrendPoint,
  AgentBreakdownRow,
  ModelBreakdownRow,
  UsageEventSearchFilter,
  UsageEventCursor,
  UsageEventRow,
  UsageEventSearchPage,
  ModelPricingRow,
} from '../domain/usage-event'
import type { ModelPricingEntity } from './model-pricing.entity'
import type { PricingConfigEntity } from './pricing-config.entity'

export class MikroOrmUsageEventRepository {
  private readonly getEm: () => EntityManager

  constructor(getEmFn?: () => EntityManager) {
    this.getEm = getEmFn ?? defaultGetEm
  }

  /** 批量写入（INSERT OR IGNORE，request_id 唯一约束保证去重）。单事务。 */
  async batchInsertEvents(events: UsageEvent[]): Promise<number> {
    if (events.length === 0) return 0
    const conn = this.getEm().getConnection()
    const CHUNK = 200
    let inserted = 0

    for (let i = 0; i < events.length; i += CHUNK) {
      const chunk = events.slice(i, i + CHUNK)
      const placeholders: string[] = []
      const values: unknown[] = []
      for (const e of chunk) {
        placeholders.push('(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        values.push(
          e.requestId, e.source, e.agentId, e.model ?? null, e.requestedModel ?? null,
          e.inputTokens, e.outputTokens, e.cacheReadTokens, e.cacheCreationTokens,
          e.inputCostUsd, e.outputCostUsd, e.cacheReadCostUsd, e.cacheCreationCostUsd, e.totalCostUsd,
          e.status ?? null, e.durationMs ?? null, e.ttfbMs ?? null, e.errorKind ?? null,
          e.accountId ?? null, e.clientKeyId ?? null, e.comboName ?? null, e.sessionId ?? null,
          e.occurredAt, e.createdAt,
        )
      }
      await conn.execute('BEGIN')
      try {
        const sql = `INSERT OR IGNORE INTO usage_events (
          request_id, source, agent_id, model, requested_model,
          input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
          input_cost_usd, output_cost_usd, cache_read_cost_usd, cache_creation_cost_usd, total_cost_usd,
          status, duration_ms, ttfb_ms, error_kind,
          account_id, client_key_id, combo_name, session_id,
          occurred_at, created_at
        ) VALUES ${placeholders.join(', ')}`
        await conn.execute(sql, values)
        // 统计实际插入数（changes 减去被忽略的）
        const changesRow = (await conn.execute('SELECT changes() AS n', [], 'get')) as { n: number }
        inserted += Number(changesRow.n)
        await conn.execute('COMMIT')
      } catch (err) {
        await conn.execute('ROLLBACK')
        throw err
      }
      // 让出事件循环，避免长时间阻塞
      await new Promise((resolve) => setImmediate(resolve))
    }
    return inserted
  }

  /** 概览汇总。 */
  async summary(window: UsageEventWindow, agentId?: string): Promise<UsageEventSummary> {
    const conn = this.getEm().getConnection()
    const whereClause = agentId
      ? `WHERE occurred_at >= ? AND occurred_at <= ? AND agent_id = ?`
      : `WHERE occurred_at >= ? AND occurred_at <= ?`
    const params = agentId ? [window.startSec, window.endSec, agentId] : [window.startSec, window.endSec]

    const row = ((await conn.execute(
      `SELECT
        COUNT(*) AS requests,
        COALESCE(SUM(input_tokens), 0) AS input_tokens,
        COALESCE(SUM(output_tokens), 0) AS output_tokens,
        COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
        COALESCE(SUM(cache_creation_tokens), 0) AS cache_creation_tokens,
        COALESCE(SUM(total_cost_usd), 0) AS total_cost_usd
       FROM usage_events ${whereClause}`,
      params,
      'get',
    )) as Record<string, unknown>) ?? {}

    const requests = Number(row.requests ?? 0)
    const inputTokens = Number(row.input_tokens ?? 0)
    const outputTokens = Number(row.output_tokens ?? 0)
    const cacheReadTokens = Number(row.cache_read_tokens ?? 0)
    const cacheCreationTokens = Number(row.cache_creation_tokens ?? 0)
    const totalCostUsd = Number(row.total_cost_usd ?? 0)

    const cacheable = inputTokens + cacheReadTokens + cacheCreationTokens
    return {
      requests,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens,
      totalTokens: inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens,
      totalCostUsd,
      cacheHitRate: cacheable > 0 ? cacheReadTokens / cacheable : 0,
    }
  }

  /** 趋势：按小时或天分组。 */
  async trend(
    window: UsageEventWindow,
    granularity: UsageEventGranularity,
    _metric: UsageEventTrendMetric,
    agentId?: string,
  ): Promise<UsageEventTrendPoint[]> {
    const conn = this.getEm().getConnection()
    const dateExpr =
      granularity === 'hour'
        ? "strftime('%Y-%m-%d %H:00', occurred_at, 'unixepoch', 'localtime')"
        : "strftime('%Y-%m-%d', occurred_at, 'unixepoch', 'localtime')"
    const whereClause = agentId
      ? `WHERE occurred_at >= ? AND occurred_at <= ? AND agent_id = ?`
      : `WHERE occurred_at >= ? AND occurred_at <= ?`
    const params = agentId ? [window.startSec, window.endSec, agentId] : [window.startSec, window.endSec]

    const rows = (await conn.execute(
      `SELECT
        ${dateExpr} AS date,
        COUNT(*) AS requests,
        COALESCE(SUM(input_tokens), 0) AS input_tokens,
        COALESCE(SUM(output_tokens), 0) AS output_tokens,
        COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
        COALESCE(SUM(cache_creation_tokens), 0) AS cache_creation_tokens,
        COALESCE(SUM(total_cost_usd), 0) AS cost_usd
       FROM usage_events ${whereClause}
       GROUP BY date ORDER BY date ASC`,
      params,
      'all',
    )) as Array<Record<string, unknown>>

    return rows.map((r) => ({
      date: String(r.date),
      requests: Number(r.requests),
      inputTokens: Number(r.input_tokens),
      outputTokens: Number(r.output_tokens),
      cacheReadTokens: Number(r.cache_read_tokens),
      cacheCreationTokens: Number(r.cache_creation_tokens),
      totalTokens: Number(r.input_tokens) + Number(r.output_tokens) + Number(r.cache_read_tokens) + Number(r.cache_creation_tokens),
      costUsd: Number(r.cost_usd),
    }))
  }

  /** agent 维度下钻。 */
  async agentBreakdown(window: UsageEventWindow): Promise<AgentBreakdownRow[]> {
    const conn = this.getEm().getConnection()
    const rows = (await conn.execute(
      `SELECT
        agent_id,
        COUNT(*) AS requests,
        COALESCE(SUM(input_tokens), 0) AS input_tokens,
        COALESCE(SUM(output_tokens), 0) AS output_tokens,
        COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
        COALESCE(SUM(cache_creation_tokens), 0) AS cache_creation_tokens,
        COALESCE(SUM(total_cost_usd), 0) AS total_cost_usd
       FROM usage_events
       WHERE occurred_at >= ? AND occurred_at <= ?
       GROUP BY agent_id ORDER BY (SUM(input_tokens) + SUM(output_tokens) + SUM(cache_read_tokens) + SUM(cache_creation_tokens)) DESC`,
      [window.startSec, window.endSec],
      'all',
    )) as Array<Record<string, unknown>>

    const grandTotal = rows.reduce((s, r) => s + Number(r.input_tokens) + Number(r.output_tokens), 0)

    return rows.map((r) => {
      const inputTokens = Number(r.input_tokens)
      const outputTokens = Number(r.output_tokens)
      const cacheReadTokens = Number(r.cache_read_tokens)
      const cacheCreationTokens = Number(r.cache_creation_tokens)
      const totalTokens = inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens
      const cacheable = inputTokens + cacheReadTokens + cacheCreationTokens
      return {
        agentId: String(r.agent_id),
        totalTokens,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheCreationTokens,
        requests: Number(r.requests),
        totalCostUsd: Number(r.total_cost_usd),
        shareRatio: grandTotal === 0 ? 0 : (inputTokens + outputTokens) / grandTotal,
        cacheHitRate: cacheable > 0 ? cacheReadTokens / cacheable : 0,
      }
    })
  }

  /** 模型维度下钻。 */
  async modelBreakdown(window: UsageEventWindow, agentId?: string): Promise<ModelBreakdownRow[]> {
    const conn = this.getEm().getConnection()
    const whereClause = agentId
      ? `WHERE occurred_at >= ? AND occurred_at <= ? AND agent_id = ?`
      : `WHERE occurred_at >= ? AND occurred_at <= ?`
    const params = agentId ? [window.startSec, window.endSec, agentId] : [window.startSec, window.endSec]

    const rows = (await conn.execute(
      `SELECT
        COALESCE(model, '—') AS model,
        COUNT(*) AS requests,
        COALESCE(SUM(input_tokens), 0) AS input_tokens,
        COALESCE(SUM(output_tokens), 0) AS output_tokens,
        COALESCE(SUM(total_cost_usd), 0) AS total_cost_usd
       FROM usage_events ${whereClause}
       GROUP BY model ORDER BY total_cost_usd DESC`,
      params,
      'all',
    )) as Array<Record<string, unknown>>

    const grandTotal = rows.reduce((s, r) => s + Number(r.input_tokens) + Number(r.output_tokens), 0)

    return rows.map((r) => {
      const requests = Number(r.requests)
      const totalCostUsd = Number(r.total_cost_usd)
      const totalTokens = Number(r.input_tokens) + Number(r.output_tokens)
      return {
        model: String(r.model),
        requests,
        totalTokens,
        inputTokens: Number(r.input_tokens),
        outputTokens: Number(r.output_tokens),
        totalCostUsd,
        avgCostUsd: requests > 0 ? totalCostUsd / requests : 0,
        shareRatio: grandTotal === 0 ? 0 : totalTokens / grandTotal,
      }
    })
  }

  /** 明细检索：keyset 分页（按 occurred_at DESC, id DESC）。 */
  async search(
    window: UsageEventWindow,
    filter: UsageEventSearchFilter,
    cursor: UsageEventCursor | undefined,
    limit = 50,
  ): Promise<UsageEventSearchPage> {
    const conn = this.getEm().getConnection()
    const conditions: string[] = ['occurred_at >= ?', 'occurred_at <= ?']
    const params: unknown[] = [window.startSec, window.endSec]

    if (filter.agentId) {
      conditions.push('agent_id = ?')
      params.push(filter.agentId)
    }
    if (filter.model) {
      conditions.push('model = ?')
      params.push(filter.model)
    }
    if (filter.source) {
      conditions.push('source = ?')
      params.push(filter.source)
    }
    if (filter.statusClass) {
      const min = parseInt(filter.statusClass, 10)
      conditions.push('status >= ? AND status < ?')
      params.push(min, min + 100)
    }
    if (filter.keyword) {
      conditions.push('(model LIKE ? OR requested_model LIKE ?)')
      const kw = `%${filter.keyword}%`
      params.push(kw, kw)
    }
    if (cursor) {
      conditions.push('(occurred_at < ? OR (occurred_at = ? AND request_id < ?))')
      params.push(cursor.occurredAt, cursor.occurredAt, cursor.requestId)
    }

    const whereClause = conditions.join(' AND ')
    const rows = (await conn.execute(
      `SELECT * FROM usage_events WHERE ${whereClause} ORDER BY occurred_at DESC, request_id DESC LIMIT ?`,
      [...params, limit + 1],
      'all',
    )) as Array<Record<string, unknown>>

    const hasNext = rows.length > limit
    const pageRows = hasNext ? rows.slice(0, limit) : rows
    const mapped: UsageEventRow[] = pageRows.map((r) => this.mapRow(r))

    let nextCursor: UsageEventCursor | undefined
    if (hasNext && mapped.length > 0) {
      const last = mapped[mapped.length - 1]
      nextCursor = { occurredAt: last.occurredAt, requestId: last.requestId }
    }

    if (nextCursor) {
      return { rows: mapped, nextCursor }
    }
    return { rows: mapped }
  }

  /** 获取单条明细。 */
  async findByRequestId(requestId: string): Promise<UsageEventRow | null> {
    const conn = this.getEm().getConnection()
    const row = (await conn.execute(
      `SELECT * FROM usage_events WHERE request_id = ? LIMIT 1`,
      [requestId],
      'get',
    )) as Record<string, unknown> | undefined
    return row ? this.mapRow(row) : null
  }

  private mapRow(r: Record<string, unknown>): UsageEventRow {
    const row: UsageEventRow = {
      requestId: String(r.request_id),
      source: String(r.source) as 'proxy' | 'session',
      agentId: String(r.agent_id),
      inputTokens: Number(r.input_tokens),
      outputTokens: Number(r.output_tokens),
      cacheReadTokens: Number(r.cache_read_tokens),
      cacheCreationTokens: Number(r.cache_creation_tokens),
      inputCostUsd: Number(r.input_cost_usd),
      outputCostUsd: Number(r.output_cost_usd),
      cacheReadCostUsd: Number(r.cache_read_cost_usd),
      cacheCreationCostUsd: Number(r.cache_creation_cost_usd),
      totalCostUsd: Number(r.total_cost_usd),
      occurredAt: Number(r.occurred_at),
      createdAt: Number(r.created_at),
    }
    const model = r.model as string | null
    if (model != null) row.model = model
    const requestedModel = r.requested_model as string | null
    if (requestedModel != null) row.requestedModel = requestedModel
    if (r.status != null) row.status = Number(r.status)
    if (r.duration_ms != null) row.durationMs = Number(r.duration_ms)
    if (r.ttfb_ms != null) row.ttfbMs = Number(r.ttfb_ms)
    const errorKind = r.error_kind as string | null
    if (errorKind != null) row.errorKind = errorKind
    const accountId = r.account_id as string | null
    if (accountId != null) row.accountId = accountId
    const clientKeyId = r.client_key_id as string | null
    if (clientKeyId != null) row.clientKeyId = clientKeyId
    const comboName = r.combo_name as string | null
    if (comboName != null) row.comboName = comboName
    const sessionId = r.session_id as string | null
    if (sessionId != null) row.sessionId = sessionId
    return row
  }
}
