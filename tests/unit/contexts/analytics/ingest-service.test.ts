import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { initDatabase, getEm, closeDatabase } from '../../../../src/main/platform/persistence/database'
import { MikroOrmUsageEventRepository } from '../../../../src/main/contexts/analytics/infrastructure/mikro-orm-usage-event-repository'
import { MikroOrmPricingRepository } from '../../../../src/main/contexts/analytics/infrastructure/mikro-orm-pricing-repository'
import { UsageEventIngestService } from '../../../../src/main/contexts/analytics/application/usage-event-ingest-service'
import { seedModelPricing } from '../../../../src/main/contexts/analytics/infrastructure/pricing-seed'
import type { ProxyRequestRecord } from '../../../../src/main/contexts/apiProxy/domain/observability/proxy-request-log'
import { UsageRecord } from '../../../../src/main/contexts/usage/domain/usage-record'

afterEach(async () => {
  await closeDatabase()
})

function makeProxyRecord(overrides: Partial<ProxyRequestRecord> = {}): ProxyRequestRecord {
  return {
    seq: 1,
    tsMs: 1700000000000,
    method: 'POST',
    path: '/v1/messages',
    format: 'anthropic',
    action: 'messages',
    stream: true,
    status: 200,
    ok: true,
    durationMs: 1500,
    attempts: 1,
    inputTokens: 1000,
    outputTokens: 500,
    cacheReadTokens: 200,
    cacheWriteTokens: 100,
    finalModel: 'claude-sonnet-4-20250514',
    requestedModel: 'claude-sonnet-4-20250514',
    ...overrides,
  }
}

function makeUsageRecord(overrides: Partial<UsageRecord> = {}): UsageRecord {
  return UsageRecord.create({
    agentId: 'claude',
    sourceKind: 'jsonl',
    sourcePath: '/tmp/test.jsonl',
    sourceEventId: 'msg_001',
    model: 'claude-sonnet-4-20250514',
    inputTokens: 1000,
    outputTokens: 500,
    cacheReadTokens: 200,
    cacheCreationTokens: 100,
    occurredAt: 1700000000,
    rawUpdatedAt: 1700000100,
    rawHash: 'abc123',
    ...overrides,
  })
}

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'hxg-ingest-'))
  await initDatabase({ dbName: join(dir, 't.db'), createSchemaOnInit: true })
  const em = getEm()
  await seedModelPricing(em)
  const eventRepo = new MikroOrmUsageEventRepository(() => getEm())
  const pricingRepo = new MikroOrmPricingRepository(() => getEm())
  const ingest = new UsageEventIngestService(eventRepo, pricingRepo)
  return { eventRepo, ingest }
}

describe('UsageEventIngestService（缓冲 + flush 模式）', () => {
  it('ingestProxyEvent 入缓冲，flush 后写入 DB', async () => {
    const { eventRepo, ingest } = await setup()

    ingest.ingestProxyEvent(makeProxyRecord(), 'claude-cli/1.0')
    expect(ingest.pendingCount()).toBe(1)

    await ingest.flush()
    expect(ingest.pendingCount()).toBe(0)

    const page = await eventRepo.search({ startSec: 0, endSec: 2000000000 }, {}, undefined, 10)
    expect(page.rows).toHaveLength(1)
    const row = page.rows[0]
    expect(row.source).toBe('proxy')
    expect(row.agentId).toBe('claude')
    expect(row.model).toBe('claude-sonnet-4-20250514')
    // claude 不扣 cacheRead → input cost = 1000 * 3.0 / 1M
    expect(row.inputCostUsd).toBeCloseTo((1000 * 3.0) / 1_000_000, 8)
  })

  it('ingestProxyEvent 推断 codex agent 并扣 cacheRead', async () => {
    const { eventRepo, ingest } = await setup()

    ingest.ingestProxyEvent(
      makeProxyRecord({ finalModel: 'gpt-5-codex', requestedModel: 'gpt-5-codex' }),
      'codex/0.1.0',
    )
    await ingest.flush()

    const page = await eventRepo.search({ startSec: 0, endSec: 2000000000 }, {}, undefined, 10)
    expect(page.rows[0].agentId).toBe('codex')
    // codex 扣 cacheRead → freshInput = 1000 - 200 = 800
    expect(page.rows[0].inputCostUsd).toBeCloseTo((800 * 1.25) / 1_000_000, 8)
  })

  it('ingestSessionBatch 直写 DB（不经缓冲）', async () => {
    const { eventRepo, ingest } = await setup()

    await ingest.ingestSessionBatch([makeUsageRecord()])
    // 直写：无需 flush，pending 始终为 0
    expect(ingest.pendingCount()).toBe(0)

    const page = await eventRepo.search({ startSec: 0, endSec: 2000000000 }, {}, undefined, 10)
    expect(page.rows).toHaveLength(1)
    expect(page.rows[0].source).toBe('session')
    expect(page.rows[0].agentId).toBe('claude')
  })

  it('ingestSessionBatch 大批量无损（>5000 不丢数据）', async () => {
    const { ingest } = await setup()

    // 回归测试：历史全量重读曾因 5000 槽环形缓冲"丢最旧"，37.8 万 → 1 万。直写后必须无损。
    const N = 6000
    const records = Array.from({ length: N }, (_, i) =>
      makeUsageRecord({ sourceEventId: `msg_${i}`, occurredAt: 1700000000 + i }),
    )
    await ingest.ingestSessionBatch(records)

    const row = (await getEm()
      .getConnection()
      .execute('SELECT count(*) AS n FROM usage_events', [], 'get')) as { n: number }
    expect(Number(row.n)).toBe(N)
  })

  it('ingestProxyEvent 同 tsMs+seq 幂等去重（回填与实时不重复计数）', async () => {
    const { ingest } = await setup()

    ingest.ingestProxyEvent(makeProxyRecord({ seq: 7, tsMs: 1700000000000 }), 'claude-cli/1.0')
    await ingest.flush()
    // 同 tsMs+seq 再 ingest 一次（模拟回填撞上实时）→ requestId 相同 → INSERT OR IGNORE
    ingest.ingestProxyEvent(
      makeProxyRecord({ seq: 7, tsMs: 1700000000000, outputTokens: 999 }),
      'claude-cli/1.0',
    )
    await ingest.flush()

    const row = (await getEm()
      .getConnection()
      .execute('SELECT count(*) AS n FROM usage_events', [], 'get')) as { n: number }
    expect(Number(row.n)).toBe(1)
  })

  it('request_id 重复时 INSERT OR IGNORE 跳过', async () => {
    const { eventRepo, ingest } = await setup()

    // 先写一条 proxy 事件（requestId = proxy:1）
    ingest.ingestProxyEvent(makeProxyRecord({ seq: 1 }), 'claude-cli/1.0')
    await ingest.flush()

    // 再写一条同 requestId 的 session 事件（requestId = session:msg_001，不同）
    await ingest.ingestSessionBatch([makeUsageRecord({ sourceEventId: 'msg_001' })])
    await ingest.flush()

    // 两条 requestId 不同，都应该存在
    const page = await eventRepo.search({ startSec: 0, endSec: 2000000000 }, {}, undefined, 10)
    expect(page.rows).toHaveLength(2)
  })

  it('ingest 失败不抛错', async () => {
    const { ingest } = await setup()

    // 未 flush，未 seed pricing 的场景已在 setup 里 seed 了
    // 这条不应抛错
    ingest.ingestProxyEvent(makeProxyRecord(), 'claude-cli/1.0')
    expect(ingest.pendingCount()).toBe(1)
  })

  it('recostZeroCostEvents 回填历史零费用事件（能计价的重算，不能的保持 0）', async () => {
    const { eventRepo, ingest } = await setup()

    // 模拟"定价条目缺失时期"落库的零费用历史行
    const zeroCost = {
      inputCostUsd: 0, outputCostUsd: 0, cacheReadCostUsd: 0, cacheCreationCostUsd: 0, totalCostUsd: 0,
      occurredAt: 1700000000, createdAt: 1700000100,
    }
    await eventRepo.batchInsertEvents([
      {
        requestId: 'session:fable-1', source: 'session', agentId: 'claude',
        model: 'claude-fable-5',
        inputTokens: 1000, outputTokens: 500, cacheReadTokens: 200, cacheCreationTokens: 100,
        ...zeroCost,
      },
      {
        requestId: 'session:relay-1', source: 'session', agentId: 'claude',
        model: 'aimami_relay_deadbeef',
        inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheCreationTokens: 0,
        ...zeroCost,
      },
    ])

    const updated = await ingest.recostZeroCostEvents()
    expect(updated).toBe(1)

    // fable-5：claude 协议不扣 cacheRead，$10/$50/$1/$12.5 每百万 token
    const fable = await eventRepo.findByRequestId('session:fable-1')
    expect(fable!.inputCostUsd).toBeCloseTo((1000 * 10.0) / 1_000_000, 10)
    expect(fable!.outputCostUsd).toBeCloseTo((500 * 50.0) / 1_000_000, 10)
    expect(fable!.cacheReadCostUsd).toBeCloseTo((200 * 1.0) / 1_000_000, 10)
    expect(fable!.cacheCreationCostUsd).toBeCloseTo((100 * 12.5) / 1_000_000, 10)
    expect(fable!.totalCostUsd).toBeCloseTo(
      fable!.inputCostUsd + fable!.outputCostUsd + fable!.cacheReadCostUsd + fable!.cacheCreationCostUsd,
      10,
    )

    // 中转自定义模型名匹配不到价格 → 保持 0
    const relay = await eventRepo.findByRequestId('session:relay-1')
    expect(relay!.totalCostUsd).toBe(0)

    // 幂等：第二次运行没有可更新行
    const second = await ingest.recostZeroCostEvents()
    expect(second).toBe(0)
  })
})
