process.env.TZ = 'UTC'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MikroORM } from '@mikro-orm/better-sqlite'
import { ReflectMetadataProvider } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/better-sqlite'
import { MikroOrmRoutingObservabilityRepository } from '../../../src/main/contexts/apiProxy/infrastructure/observability/mikro-orm-routing-observability.repository'
import type { RoutingEvent } from '../../../src/main/contexts/apiProxy/domain/observability/routing-event'

/* eslint-disable @typescript-eslint/no-explicit-any */

let testOrm: MikroORM
function testGetEm(): EntityManager {
  return testOrm.em.fork()
}

beforeEach(async () => {
  testOrm = await MikroORM.init({
    metadataProvider: ReflectMetadataProvider,
    dbName: ':memory:',
    entities: [],
    entitiesTs: [],
    debug: false,
    discovery: { warnWhenNoEntities: false, requireEntitiesArray: false },
  })
  const conn = testOrm.em.getConnection()
  await conn.execute(`CREATE TABLE routing_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, seq INTEGER NOT NULL DEFAULT 0,
    ts_ms BIGINT NOT NULL DEFAULT 0, ts_sec BIGINT NOT NULL DEFAULT 0,
    method TEXT, path TEXT, format TEXT, platform TEXT, action TEXT,
    stream INTEGER NOT NULL DEFAULT 0, status INTEGER NOT NULL DEFAULT 0, ok INTEGER NOT NULL DEFAULT 0,
    error_kind TEXT, error_message TEXT,
    duration_ms INTEGER NOT NULL DEFAULT 0, ttfb_ms INTEGER, upstream_ms INTEGER,
    attempts INTEGER NOT NULL DEFAULT 0, route_hops INTEGER, route_path TEXT,
    combo_name TEXT, requested_model TEXT, final_model TEXT,
    account_id TEXT, client_key_id TEXT, upstream_endpoint TEXT, proxy_id TEXT,
    input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER, cache_write_tokens INTEGER,
    req_bytes INTEGER, resp_bytes INTEGER, client_ip TEXT, user_agent TEXT
  )`)
  await conn.execute(`CREATE TABLE routing_rollup_daily (
    date TEXT NOT NULL, platform TEXT NOT NULL, combo_name TEXT NOT NULL,
    records_count INTEGER NOT NULL DEFAULT 0, success_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0, sum_duration_ms BIGINT NOT NULL DEFAULT 0,
    sum_ttfb_ms BIGINT NOT NULL DEFAULT 0, input_tokens BIGINT NOT NULL DEFAULT 0,
    output_tokens BIGINT NOT NULL DEFAULT 0, cache_read_tokens BIGINT NOT NULL DEFAULT 0,
    cache_write_tokens BIGINT NOT NULL DEFAULT 0, updated_at BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (date, platform, combo_name)
  )`)
  await conn.execute(`CREATE TABLE routing_rollup_model_daily (
    date TEXT NOT NULL, model TEXT NOT NULL,
    records_count INTEGER NOT NULL DEFAULT 0, success_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0, sum_duration_ms BIGINT NOT NULL DEFAULT 0,
    sum_ttfb_ms BIGINT NOT NULL DEFAULT 0, input_tokens BIGINT NOT NULL DEFAULT 0,
    output_tokens BIGINT NOT NULL DEFAULT 0, cache_read_tokens BIGINT NOT NULL DEFAULT 0,
    cache_write_tokens BIGINT NOT NULL DEFAULT 0, updated_at BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (date, model)
  )`)
  await conn.execute(`CREATE TABLE routing_rollup_account_daily (
    date TEXT NOT NULL, account_id TEXT NOT NULL,
    records_count INTEGER NOT NULL DEFAULT 0, success_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0, rate_limited_count INTEGER NOT NULL DEFAULT 0,
    sum_duration_ms BIGINT NOT NULL DEFAULT 0, sum_ttfb_ms BIGINT NOT NULL DEFAULT 0,
    input_tokens BIGINT NOT NULL DEFAULT 0, output_tokens BIGINT NOT NULL DEFAULT 0,
    cache_read_tokens BIGINT NOT NULL DEFAULT 0, cache_write_tokens BIGINT NOT NULL DEFAULT 0,
    updated_at BIGINT NOT NULL DEFAULT 0, PRIMARY KEY (date, account_id)
  )`)
  await conn.execute(`CREATE TABLE routing_rollup_status_daily (
    date TEXT NOT NULL, status_class TEXT NOT NULL,
    records_count INTEGER NOT NULL DEFAULT 0, sum_duration_ms BIGINT NOT NULL DEFAULT 0,
    sum_ttfb_ms BIGINT NOT NULL DEFAULT 0, input_tokens BIGINT NOT NULL DEFAULT 0,
    output_tokens BIGINT NOT NULL DEFAULT 0, updated_at BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (date, status_class)
  )`)
})
afterEach(async () => {
  if (testOrm) await testOrm.close(true)
})

function ev(seq: number, over: Partial<RoutingEvent> = {}): RoutingEvent {
  return {
    seq,
    tsMs: 1_700_000_000_000,
    method: 'POST',
    path: '/v1/messages',
    format: 'anthropic',
    action: 'messages',
    stream: false,
    status: 200,
    ok: true,
    errorKind: 'none',
    durationMs: 100,
    attempts: 1,
    ...over,
  }
}

const FULL_WINDOW = { startSec: 0, endSec: 4_102_444_800 }

describe('MikroOrmRoutingObservabilityRepository', () => {
  it('ingestBatch：写明细（含新列 ttfb/error_kind 映射）', async () => {
    const repo = new MikroOrmRoutingObservabilityRepository(testGetEm)
    await repo.ingestBatch([
      ev(1, { ttfbMs: 30, finalModel: 'claude-x', inputTokens: 10, outputTokens: 5 }),
      ev(2, { ok: false, status: 500, errorKind: 'upstream_5xx', errorMessage: 'boom' }),
    ])
    const conn = testGetEm().getConnection()
    const rows = (await conn.execute('SELECT * FROM routing_events ORDER BY seq', [], 'all')) as any[]
    expect(rows).toHaveLength(2)
    expect(rows[0].error_kind).toBe('none')
    expect(Number(rows[0].ttfb_ms)).toBe(30)
    expect(rows[0].final_model).toBe('claude-x')
    expect(Number(rows[1].ok)).toBe(0)
    expect(rows[1].error_kind).toBe('upstream_5xx')
    expect(rows[1].error_message).toBe('boom')
  })

  it('daily 日桶：增量 UPSERT 跨批累加同键', async () => {
    const repo = new MikroOrmRoutingObservabilityRepository(testGetEm)
    const tsMs = new Date('2026-06-15T10:00:00Z').getTime()
    await repo.ingestBatch([ev(1, { tsMs, platform: 'kiro', durationMs: 100, inputTokens: 10 })])
    await repo.ingestBatch([ev(2, { tsMs, platform: 'kiro', durationMs: 200, inputTokens: 20 })])
    const conn = testGetEm().getConnection()
    const row = (await conn.execute(
      `SELECT * FROM routing_rollup_daily WHERE platform = 'kiro'`,
      [],
      'get',
    )) as any
    expect(Number(row.records_count)).toBe(2)
    expect(Number(row.sum_duration_ms)).toBe(300)
    expect(Number(row.input_tokens)).toBe(30)
  })

  it('model/account/status 日桶聚合 + 429 限流计数 + 状态类拆分', async () => {
    const repo = new MikroOrmRoutingObservabilityRepository(testGetEm)
    const tsMs = new Date('2026-06-15T10:00:00Z').getTime()
    await repo.ingestBatch([
      ev(1, { tsMs, finalModel: 'm1', accountId: 'a1', status: 200, ok: true }),
      ev(2, {
        tsMs,
        finalModel: 'm1',
        accountId: 'a1',
        status: 429,
        ok: false,
        errorKind: 'ratelimit',
      }),
    ])
    const conn = testGetEm().getConnection()
    const m = (await conn.execute(
      `SELECT * FROM routing_rollup_model_daily WHERE model = 'm1'`,
      [],
      'get',
    )) as any
    expect(Number(m.records_count)).toBe(2)
    expect(Number(m.success_count)).toBe(1)
    const a = (await conn.execute(
      `SELECT * FROM routing_rollup_account_daily WHERE account_id = 'a1'`,
      [],
      'get',
    )) as any
    expect(Number(a.records_count)).toBe(2)
    expect(Number(a.rate_limited_count)).toBe(1)
    const s4 = (await conn.execute(
      `SELECT * FROM routing_rollup_status_daily WHERE status_class = '4xx'`,
      [],
      'get',
    )) as any
    expect(Number(s4.records_count)).toBe(1) // 429 → 4xx
    const s2 = (await conn.execute(
      `SELECT * FROM routing_rollup_status_daily WHERE status_class = '2xx'`,
      [],
      'get',
    )) as any
    expect(Number(s2.records_count)).toBe(1)
  })

  it('clearAll：清空明细 + 4 日桶', async () => {
    const repo = new MikroOrmRoutingObservabilityRepository(testGetEm)
    await repo.ingestBatch([ev(1, { platform: 'kiro', finalModel: 'm', accountId: 'a' })])
    await repo.clearAll()
    const conn = testGetEm().getConnection()
    const count = async (table: string) =>
      Number(((await conn.execute(`SELECT COUNT(*) AS c FROM ${table}`, [], 'get')) as any).c)
    expect(await count('routing_events')).toBe(0)
    expect(await count('routing_rollup_daily')).toBe(0)
    expect(await count('routing_rollup_model_daily')).toBe(0)
    expect(await count('routing_rollup_account_daily')).toBe(0)
    expect(await count('routing_rollup_status_daily')).toBe(0)
  })

  it('purge：删早于 cutoff 的明细 + 日桶', async () => {
    const repo = new MikroOrmRoutingObservabilityRepository(testGetEm)
    const oldTs = new Date('2026-01-01T00:00:00Z').getTime()
    const newTs = new Date('2026-06-15T00:00:00Z').getTime()
    await repo.ingestBatch([ev(1, { tsMs: oldTs, platform: 'kiro' })])
    await repo.ingestBatch([ev(2, { tsMs: newTs, platform: 'kiro' })])
    const cutoffSec = Math.floor(new Date('2026-03-01T00:00:00Z').getTime() / 1000)
    await repo.purge(cutoffSec, '2026-03-01')
    const conn = testGetEm().getConnection()
    const evRows = (await conn.execute('SELECT seq FROM routing_events', [], 'all')) as any[]
    expect(evRows.map((r) => Number(r.seq))).toEqual([2])
    const dRows = (await conn.execute('SELECT date FROM routing_rollup_daily', [], 'all')) as any[]
    expect(dRows).toHaveLength(1)
  })

  // ── 查询 ──────────────────────────────────────────────────────────────────

  it('summary：计数/成功率/ttfb/token/fallback/combo', async () => {
    const repo = new MikroOrmRoutingObservabilityRepository(testGetEm)
    await repo.ingestBatch([
      ev(1, {
        ok: true,
        status: 200,
        durationMs: 100,
        ttfbMs: 20,
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 2,
        comboName: 'cb',
        routeHops: 2,
      }),
      ev(2, { ok: false, status: 500, durationMs: 300, errorKind: 'upstream_5xx' }),
    ])
    const s = await repo.summary(FULL_WINDOW)
    expect(s.requests).toBe(2)
    expect(s.success).toBe(1)
    expect(s.failed).toBe(1)
    expect(s.successRate).toBe(0.5)
    expect(s.avgDurationMs).toBe(200)
    expect(s.avgTtfbMs).toBe(20) // 仅 1 条有 ttfb
    expect(s.inputTokens).toBe(10)
    expect(s.totalTokens).toBe(17) // 10 + 5 + 2
    expect(s.fallbackRequests).toBe(1) // routeHops > 1
    expect(s.comboRequests).toBe(1)
  })

  it('breakdown(clientKey)：按客户端 Key 分组 + 占比', async () => {
    const repo = new MikroOrmRoutingObservabilityRepository(testGetEm)
    await repo.ingestBatch([
      ev(1, { clientKeyId: 'k1' }),
      ev(2, { clientKeyId: 'k1' }),
      ev(3, { clientKeyId: 'k2' }),
    ])
    const rows = await repo.breakdown(FULL_WINDOW, 'clientKey')
    expect(rows[0].key).toBe('k1')
    expect(rows[0].requests).toBe(2)
    expect(rows[0].shareRatio).toBeCloseTo(2 / 3)
  })

  it('topErrors：按 errorKind + message 归并、计数排序、成功不计', async () => {
    const repo = new MikroOrmRoutingObservabilityRepository(testGetEm)
    await repo.ingestBatch([
      ev(1, { ok: false, status: 500, errorKind: 'upstream_5xx', errorMessage: 'boom' }),
      ev(2, { ok: false, status: 500, errorKind: 'upstream_5xx', errorMessage: 'boom' }),
      ev(3, { ok: false, status: 429, errorKind: 'ratelimit', errorMessage: 'slow down' }),
      ev(4, { ok: true, status: 200 }),
    ])
    const rows = await repo.topErrors(FULL_WINDOW, 10)
    expect(rows[0].errorKind).toBe('upstream_5xx')
    expect(rows[0].count).toBe(2)
    expect(rows.find((r) => r.errorKind === 'ratelimit')?.count).toBe(1)
    expect(rows.reduce((sum, r) => sum + r.count, 0)).toBe(3)
  })

  it('accountStats：账号聚合 + 429 限流计数 + 平均延迟', async () => {
    const repo = new MikroOrmRoutingObservabilityRepository(testGetEm)
    await repo.ingestBatch([
      ev(1, { accountId: 'a1', ok: true, status: 200, durationMs: 100 }),
      ev(2, { accountId: 'a1', ok: false, status: 429, durationMs: 200 }),
    ])
    const stats = await repo.accountStats(FULL_WINDOW)
    expect(stats).toHaveLength(1)
    expect(stats[0].accountId).toBe('a1')
    expect(stats[0].requests).toBe(2)
    expect(stats[0].rateLimited).toBe(1)
    expect(stats[0].avgDurationMs).toBe(150)
  })

  it('search：keyset 分页 + keyword + failedOnly 过滤', async () => {
    const repo = new MikroOrmRoutingObservabilityRepository(testGetEm)
    const base = 1_700_000_000_000
    await repo.ingestBatch([
      ev(1, { tsMs: base + 1000, path: '/v1/messages', finalModel: 'claude', ok: true }),
      ev(2, {
        tsMs: base + 2000,
        path: '/v1/chat',
        finalModel: 'gpt',
        ok: false,
        status: 500,
        errorKind: 'upstream_5xx',
      }),
      ev(3, { tsMs: base + 3000, path: '/v1/messages', finalModel: 'claude', ok: true }),
    ])
    // 倒序 keyset 分页：limit 2 → 第一页 [3,2] + nextCursor；第二页 [1] 无 cursor。
    const p1 = await repo.search(FULL_WINDOW, {}, undefined, 2)
    expect(p1.rows.map((r) => r.seq)).toEqual([3, 2])
    expect(p1.nextCursor).toBeDefined()
    const p2 = await repo.search(FULL_WINDOW, {}, p1.nextCursor, 2)
    expect(p2.rows.map((r) => r.seq)).toEqual([1])
    expect(p2.nextCursor).toBeUndefined()
    // keyword（命中 path）
    const kw = await repo.search(FULL_WINDOW, { keyword: 'chat' }, undefined, 10)
    expect(kw.rows.map((r) => r.seq)).toEqual([2])
    // failedOnly
    const failed = await repo.search(FULL_WINDOW, { failedOnly: true }, undefined, 10)
    expect(failed.rows.map((r) => r.seq)).toEqual([2])
  })

  it('detail：按 id 取单条（含新字段）；不存在返回 undefined', async () => {
    const repo = new MikroOrmRoutingObservabilityRepository(testGetEm)
    await repo.ingestBatch([
      ev(1, { ttfbMs: 33, upstreamEndpoint: 'api.example.com', finalModel: 'm', routePath: ['a', 'b'] }),
    ])
    const page = await repo.search(FULL_WINDOW, {}, undefined, 10)
    const id = page.rows[0]!.id
    const d = await repo.detail(id)
    expect(d?.ttfbMs).toBe(33)
    expect(d?.upstreamEndpoint).toBe('api.example.com')
    expect(d?.routePath).toEqual(['a', 'b'])
    expect(await repo.detail(999_999)).toBeUndefined()
  })
})
