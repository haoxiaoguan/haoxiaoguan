process.env.TZ = 'UTC'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MikroORM } from '@mikro-orm/better-sqlite'
import { ReflectMetadataProvider } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/better-sqlite'
import { MikroOrmRoutingLogRepository } from '../../../src/main/contexts/apiProxy/infrastructure/routing-log/mikro-orm-routing-log.repository'
import type { ProxyRequestRecord } from '../../../src/main/contexts/apiProxy/domain/observability/proxy-request-log'

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
  await conn.execute(`CREATE TABLE routing_request_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, seq INTEGER NOT NULL DEFAULT 0,
    ts_ms BIGINT NOT NULL DEFAULT 0, ts_sec BIGINT NOT NULL DEFAULT 0,
    method TEXT, path TEXT, format TEXT, platform TEXT, action TEXT,
    stream INTEGER NOT NULL DEFAULT 0, status INTEGER NOT NULL DEFAULT 0, ok INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0,
    account_id TEXT, client_key_id TEXT, combo_name TEXT, requested_model TEXT, final_model TEXT,
    route_hops INTEGER, route_path TEXT, input_tokens INTEGER, output_tokens INTEGER,
    cache_read_tokens INTEGER, cache_write_tokens INTEGER, error_message TEXT
  )`)
  await conn.execute(`CREATE TABLE routing_daily_rollups (
    date TEXT NOT NULL, platform TEXT NOT NULL, combo_name TEXT NOT NULL,
    records_count INTEGER NOT NULL DEFAULT 0, success_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0, sum_duration_ms BIGINT NOT NULL DEFAULT 0,
    input_tokens BIGINT NOT NULL DEFAULT 0, output_tokens BIGINT NOT NULL DEFAULT 0,
    updated_at BIGINT NOT NULL DEFAULT 0, PRIMARY KEY (date, platform, combo_name)
  )`)
})
afterEach(async () => {
  if (testOrm) await testOrm.close(true)
})

function rec(seq: number, over: Partial<ProxyRequestRecord> = {}): ProxyRequestRecord {
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
    durationMs: 100,
    attempts: 1,
    ...over,
  }
}

const FULL_WINDOW = { startSec: 0, endSec: 4_102_444_800 }

describe('MikroOrmRoutingLogRepository', () => {
  it('insertMany + summary：计数/成功率/Token/降级/组合', async () => {
    const repo = new MikroOrmRoutingLogRepository(testGetEm)
    await repo.insertMany([
      rec(1, {
        ok: true,
        status: 200,
        durationMs: 100,
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 100,
        cacheWriteTokens: 20,
      }),
      rec(2, { ok: false, status: 502, durationMs: 300, errorMessage: 'upstream 502' }),
      rec(3, {
        ok: true,
        status: 200,
        durationMs: 200,
        comboName: 'my-coding',
        routeHops: 2,
        inputTokens: 7,
      }),
    ])
    const s = await repo.summary(FULL_WINDOW)
    expect(s.requests).toBe(3)
    expect(s.success).toBe(2)
    expect(s.failed).toBe(1)
    expect(s.successRate).toBeCloseTo(2 / 3)
    expect(s.errorRate).toBeCloseTo(1 / 3)
    expect(s.avgDurationMs).toBe(200) // (100+300+200)/3
    expect(s.inputTokens).toBe(17)
    expect(s.outputTokens).toBe(5)
    expect(s.cacheReadTokens).toBe(100)
    expect(s.cacheWriteTokens).toBe(20)
    expect(s.totalTokens).toBe(142) // 17 + 5 + 100 + 20
    expect(s.fallbackRequests).toBe(1) // routeHops>1
    expect(s.comboRequests).toBe(1)
    expect(s.peakRpm).toBe(3) // 3 条同一分钟
  })

  it('summary 空窗口返回 0、successRate=0', async () => {
    const repo = new MikroOrmRoutingLogRepository(testGetEm)
    const s = await repo.summary(FULL_WINDOW)
    expect(s.requests).toBe(0)
    expect(s.successRate).toBe(0)
    expect(s.p95DurationMs).toBe(0)
    expect(s.peakRpm).toBe(0)
  })

  it('peakRpm：按自然分钟桶取最大值（非总和）', async () => {
    const repo = new MikroOrmRoutingLogRepository(testGetEm)
    // 桶按绝对自然分钟（ts_sec/60）划分；1_700_000_040 整除 60，是分钟 B 的起点。
    await repo.insertMany([
      rec(1, { tsMs: 1_700_000_000_000 }), // 分钟 A（ts_sec 1_700_000_000）
      rec(2, { tsMs: 1_700_000_030_000 }), // 分钟 A
      rec(3, { tsMs: 1_700_000_040_000 }), // 分钟 B
      rec(4, { tsMs: 1_700_000_070_000 }), // 分钟 B
      rec(5, { tsMs: 1_700_000_099_000 }), // 分钟 B
    ])
    const s = await repo.summary(FULL_WINDOW)
    expect(s.requests).toBe(5)
    expect(s.peakRpm).toBe(3) // 分钟 B 有 3 条
  })

  it('P95 延迟：20 条 1..20ms → nearest-rank 第 19 条 = 19', async () => {
    const repo = new MikroOrmRoutingLogRepository(testGetEm)
    await repo.insertMany(Array.from({ length: 20 }, (_, i) => rec(i + 1, { durationMs: i + 1 })))
    const s = await repo.summary(FULL_WINDOW)
    expect(s.p95DurationMs).toBe(19)
  })

  it('trend(hour)：按小时桶聚合明细', async () => {
    const repo = new MikroOrmRoutingLogRepository(testGetEm)
    await repo.insertMany([
      rec(1, { tsMs: 1_700_000_000_000, ok: true }), // 2023-11-14 22:13 UTC
      rec(2, { tsMs: 1_700_000_060_000, ok: false, status: 500 }),
      rec(3, { tsMs: 1_700_003_600_000, ok: true }), // 次一小时
    ])
    const pts = await repo.trend(FULL_WINDOW, 'hour')
    expect(
      pts.map((p) => ({ date: p.date, req: p.requests, ok: p.success, fail: p.failed })),
    ).toEqual([
      { date: '2023-11-14 22:00', req: 2, ok: 1, fail: 1 },
      { date: '2023-11-14 23:00', req: 1, ok: 1, fail: 0 },
    ])
  })

  it('rebuildRollupsSince + trend(day)：日桶聚合', async () => {
    const repo = new MikroOrmRoutingLogRepository(testGetEm)
    const min = await repo.insertMany([
      rec(1, { tsMs: 1_700_000_000_000, ok: true, durationMs: 100 }),
      rec(2, { tsMs: 1_700_000_060_000, ok: false, status: 500, durationMs: 300 }),
    ])
    expect(min).not.toBeNull()
    await repo.rebuildRollupsSince(min as number)
    const pts = await repo.trend(FULL_WINDOW, 'day')
    expect(pts).toHaveLength(1)
    expect(pts[0]).toMatchObject({
      date: '2023-11-14',
      requests: 2,
      success: 1,
      failed: 1,
      avgDurationMs: 200,
    })
  })

  it('breakdown(platform)：分组 + 占比', async () => {
    const repo = new MikroOrmRoutingLogRepository(testGetEm)
    await repo.insertMany([
      rec(1, { platform: 'kiro', ok: true }),
      rec(2, { platform: 'kiro', ok: false, status: 429 }),
      rec(3, { platform: 'codex-native', ok: true }),
    ])
    const rows = await repo.breakdown(FULL_WINDOW, 'platform')
    expect(rows.map((r) => r.key)).toEqual(['kiro', 'codex-native'])
    expect(rows[0]).toMatchObject({ requests: 2, success: 1, failed: 1 })
    expect(rows[0].shareRatio).toBeCloseTo(2 / 3)
    expect(rows[1].shareRatio).toBeCloseTo(1 / 3)
  })

  it('breakdown(status)：状态类聚合 2xx/4xx/5xx', async () => {
    const repo = new MikroOrmRoutingLogRepository(testGetEm)
    await repo.insertMany([
      rec(1, { status: 200, ok: true }),
      rec(2, { status: 429, ok: false }),
      rec(3, { status: 500, ok: false }),
      rec(4, { status: 503, ok: false }),
    ])
    const rows = await repo.breakdown(FULL_WINDOW, 'status')
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r.requests]))
    expect(byKey['5xx']).toBe(2)
    expect(byKey['4xx']).toBe(1)
    expect(byKey['2xx']).toBe(1)
  })

  it('topErrors：仅失败、按消息归并、计数排序', async () => {
    const repo = new MikroOrmRoutingLogRepository(testGetEm)
    await repo.insertMany([
      rec(1, { ok: false, status: 502, errorMessage: 'upstream 502' }),
      rec(2, { ok: false, status: 502, errorMessage: 'upstream 502' }),
      rec(3, { ok: false, status: 429, errorMessage: 'rate limited' }),
      rec(4, { ok: true, status: 200 }),
    ])
    const errs = await repo.topErrors(FULL_WINDOW, 10)
    expect(errs[0]).toMatchObject({ message: 'upstream 502', count: 2, lastStatus: 502 })
    expect(errs[1]).toMatchObject({ message: 'rate limited', count: 1 })
  })

  it('recent：倒序 + 失败过滤 + routePath 解析', async () => {
    const repo = new MikroOrmRoutingLogRepository(testGetEm)
    await repo.insertMany([
      rec(1, { tsMs: 1_700_000_000_000, ok: true }),
      rec(2, {
        tsMs: 1_700_000_100_000,
        ok: false,
        status: 500,
        comboName: 'cmb',
        routeHops: 2,
        routePath: ['kr/claude', 'relay-x/deepseek'],
        cacheReadTokens: 512,
        cacheWriteTokens: 64,
      }),
    ])
    const all = await repo.recent(10, {})
    expect(all.map((r) => r.seq)).toEqual([2, 1]) // ts 倒序
    expect(all[0].routePath).toEqual(['kr/claude', 'relay-x/deepseek'])
    expect(all[0].cacheReadTokens).toBe(512)
    expect(all[0].cacheWriteTokens).toBe(64)

    const failed = await repo.recent(10, { failedOnly: true })
    expect(failed.map((r) => r.seq)).toEqual([2])
  })

  it('accountStats：按账号聚合请求/成功/失败 + 平均延迟，无账号不计', async () => {
    const repo = new MikroOrmRoutingLogRepository(testGetEm)
    await repo.insertMany([
      rec(1, {
        accountId: 'acc-a',
        ok: true,
        durationMs: 100,
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 100,
      }),
      rec(2, { accountId: 'acc-a', ok: false, status: 500, durationMs: 300, inputTokens: 7, cacheWriteTokens: 20 }),
      rec(3, { accountId: 'acc-a', ok: false, status: 429, durationMs: 50 }), // 限流
      rec(4, { accountId: 'acc-b', ok: true, durationMs: 200 }),
      rec(5, { ok: true }), // 无 account_id → 不计入
    ])
    const stats = await repo.accountStats(FULL_WINDOW)
    const byId = Object.fromEntries(stats.map((s) => [s.accountId, s]))
    expect(byId['acc-a']).toMatchObject({
      requests: 3,
      success: 1,
      failed: 2,
      rateLimited: 1,
      avgDurationMs: 150,
      peakRpm: 3, // 3 条同一分钟
      inputTokens: 17, // 10 + 7
      outputTokens: 5,
      cacheTokens: 120, // 缓存读 100 + 缓存写 20
    })
    expect(byId['acc-b']).toMatchObject({
      requests: 1,
      success: 1,
      failed: 0,
      rateLimited: 0,
      avgDurationMs: 200,
      peakRpm: 1,
      inputTokens: 0,
      outputTokens: 0,
      cacheTokens: 0,
    })
    expect(stats.some((s) => s.accountId === '' || s.accountId === 'null')).toBe(false)
  })

  it('accountStats peakRpm：每账号按分钟桶取最大（非总和）', async () => {
    const repo = new MikroOrmRoutingLogRepository(testGetEm)
    await repo.insertMany([
      rec(1, { accountId: 'acc-a', tsMs: 1_700_000_000_000 }), // 分钟 A
      rec(2, { accountId: 'acc-a', tsMs: 1_700_000_030_000 }), // 分钟 A
      rec(3, { accountId: 'acc-a', tsMs: 1_700_000_060_000 }), // 分钟 B
      rec(4, { accountId: 'acc-b', tsMs: 1_700_000_000_000 }), // 分钟 A
    ])
    const byId = Object.fromEntries((await repo.accountStats(FULL_WINDOW)).map((s) => [s.accountId, s]))
    expect(byId['acc-a']).toMatchObject({ requests: 3, peakRpm: 2 }) // 分钟 A 有 2 条
    expect(byId['acc-b']).toMatchObject({ requests: 1, peakRpm: 1 })
  })

  it('clearAll 清空两表', async () => {
    const repo = new MikroOrmRoutingLogRepository(testGetEm)
    const min = await repo.insertMany([rec(1)])
    await repo.rebuildRollupsSince(min as number)
    await repo.clearAll()
    expect((await repo.summary(FULL_WINDOW)).requests).toBe(0)
    expect(await repo.trend(FULL_WINDOW, 'day')).toEqual([])
  })

  it('purge：删早于 cutoff 的明细与日桶', async () => {
    const repo = new MikroOrmRoutingLogRepository(testGetEm)
    await repo.insertMany([
      rec(1, { tsMs: 1_600_000_000_000 }), // 老
      rec(2, { tsMs: 1_700_000_000_000 }), // 新
    ])
    await repo.purge(1_650_000_000, '2021-01-01')
    const all = await repo.recent(10, {})
    expect(all.map((r) => r.seq)).toEqual([2])
  })
})
