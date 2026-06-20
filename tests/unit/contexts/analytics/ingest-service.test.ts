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

describe('UsageEventIngestService', () => {
  it('ingestProxyEvent 正确投影字段并计算 cost', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hxg-ingest-1-'))
    await initDatabase({ dbName: join(dir, 't.db'), createSchemaOnInit: true })
    const em = getEm()
    await seedModelPricing(em)

    const eventRepo = new MikroOrmUsageEventRepository(() => getEm())
    const pricingRepo = new MikroOrmPricingRepository(() => getEm())
    const ingest = new UsageEventIngestService(eventRepo, pricingRepo)

    await ingest.ingestProxyEvent(makeProxyRecord(), 'claude-cli/1.0')

    const page = await eventRepo.search({ startSec: 0, endSec: 2000000000 }, {}, undefined, 10)
    expect(page.rows).toHaveLength(1)
    const row = page.rows[0]
    expect(row.source).toBe('proxy')
    expect(row.agentId).toBe('claude')
    expect(row.model).toBe('claude-sonnet-4-20250514')
    expect(row.inputTokens).toBe(1000)
    expect(row.outputTokens).toBe(500)
    // claude 不扣 cacheRead → input cost = 1000 * 3.0 / 1M
    expect(row.inputCostUsd).toBeCloseTo((1000 * 3.0) / 1_000_000, 8)
    expect(row.totalCostUsd).toBeGreaterThan(0)
  })

  it('ingestProxyEvent 用 user-agent 推断 agent（codex）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hxg-ingest-2-'))
    await initDatabase({ dbName: join(dir, 't.db'), createSchemaOnInit: true })
    const em = getEm()
    await seedModelPricing(em)

    const eventRepo = new MikroOrmUsageEventRepository(() => getEm())
    const pricingRepo = new MikroOrmPricingRepository(() => getEm())
    const ingest = new UsageEventIngestService(eventRepo, pricingRepo)

    await ingest.ingestProxyEvent(
      makeProxyRecord({ finalModel: 'gpt-5-codex', requestedModel: 'gpt-5-codex' }),
      'codex/0.1.0',
    )

    const page = await eventRepo.search({ startSec: 0, endSec: 2000000000 }, {}, undefined, 10)
    expect(page.rows[0].agentId).toBe('codex')
    // codex 扣 cacheRead → freshInput = 1000 - 200 = 800
    expect(page.rows[0].inputCostUsd).toBeCloseTo((800 * 1.25) / 1_000_000, 8)
  })

  it('ingestSessionBatch 去重命中时不重复插入', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hxg-ingest-3-'))
    await initDatabase({ dbName: join(dir, 't.db'), createSchemaOnInit: true })
    const em = getEm()
    await seedModelPricing(em)

    const eventRepo = new MikroOrmUsageEventRepository(() => getEm())
    const pricingRepo = new MikroOrmPricingRepository(() => getEm())
    const ingest = new UsageEventIngestService(eventRepo, pricingRepo)

    // 先写一条 proxy 事件（指纹与 session 记录匹配）
    await ingest.ingestProxyEvent(
      makeProxyRecord({
        seq: 42,
        tsMs: 1700000000000,
        finalModel: 'claude-sonnet-4-20250514',
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadTokens: 200,
        cacheWriteTokens: 100,
      }),
      'claude-cli/1.0',
    )

    // session 记录指纹匹配（同 model + token + 时间窗口）→ 应被去重
    await ingest.ingestSessionBatch([makeUsageRecord()])

    const page = await eventRepo.search({ startSec: 0, endSec: 2000000000 }, {}, undefined, 10)
    expect(page.rows).toHaveLength(1) // 只有 proxy 那条
  })

  it('ingestSessionBatch 无匹配时正常插入', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hxg-ingest-4-'))
    await initDatabase({ dbName: join(dir, 't.db'), createSchemaOnInit: true })
    const em = getEm()
    await seedModelPricing(em)

    const eventRepo = new MikroOrmUsageEventRepository(() => getEm())
    const pricingRepo = new MikroOrmPricingRepository(() => getEm())
    const ingest = new UsageEventIngestService(eventRepo, pricingRepo)

    await ingest.ingestSessionBatch([makeUsageRecord()])

    const page = await eventRepo.search({ startSec: 0, endSec: 2000000000 }, {}, undefined, 10)
    expect(page.rows).toHaveLength(1)
    expect(page.rows[0].source).toBe('session')
    expect(page.rows[0].agentId).toBe('claude')
  })

  it('ingest 失败不抛错（吞错策略）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hxg-ingest-5-'))
    await initDatabase({ dbName: join(dir, 't.db'), createSchemaOnInit: true })

    // 用一个会触发错误的 repo（pricingRepo 未 seed，但不应抛错）
    const eventRepo = new MikroOrmUsageEventRepository(() => getEm())
    const pricingRepo = new MikroOrmPricingRepository(() => getEm())
    const ingest = new UsageEventIngestService(eventRepo, pricingRepo)

    // 未 seed pricing → findPrice 返回 null → cost 全 0，但不报错
    await expect(ingest.ingestProxyEvent(makeProxyRecord(), 'claude-cli/1.0')).resolves.toBeUndefined()

    const page = await eventRepo.search({ startSec: 0, endSec: 2000000000 }, {}, undefined, 10)
    expect(page.rows).toHaveLength(1)
    expect(page.rows[0].totalCostUsd).toBe(0) // 未计价
  })
})
