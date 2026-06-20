import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { initDatabase, getEm, closeDatabase } from '../../../../src/main/platform/persistence/database'
import { MikroOrmUsageEventRepository } from '../../../../src/main/contexts/analytics/infrastructure/mikro-orm-usage-event-repository'
import type { UsageEvent } from '../../../../src/main/contexts/analytics/domain/usage-event'

afterEach(async () => {
  await closeDatabase()
})

function makeProxyEvent(overrides: Partial<UsageEvent> = {}): UsageEvent {
  return {
    dedupId: 'proxy-req-001',
    source: 'proxy',
    agentId: 'claude',
    model: 'claude-sonnet-4-20250514',
    inputTokens: 1000,
    outputTokens: 500,
    cacheReadTokens: 200,
    cacheCreationTokens: 100,
    inputCostUsd: 0.003,
    outputCostUsd: 0.0075,
    cacheReadCostUsd: 0.00006,
    cacheCreationCostUsd: 0.000375,
    totalCostUsd: 0.010935,
    status: 200,
    durationMs: 1500,
    occurredAt: 1700000000,
    createdAt: 1700000100,
    ...overrides,
  }
}

describe('MikroOrmUsageEventRepository', () => {
  it('insertProxyEvent 后 search 能查到', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hxg-repo-'))
    await initDatabase({ dbName: join(dir, 't.db'), createSchemaOnInit: true })
    const repo = new MikroOrmUsageEventRepository(() => getEm())

    await repo.batchInsertEvents([makeProxyEvent()])
    const page = await repo.search(
      { startSec: 1699999000, endSec: 1700001000 },
      {},
      undefined,
      10,
    )
    expect(page.rows).toHaveLength(1)
    expect(page.rows[0].agentId).toBe('claude')
    expect(page.rows[0].model).toBe('claude-sonnet-4-20250514')
  })

  it('相同 dedup_id 的 INSERT OR IGNORE 跳过', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hxg-repo-dedup1-'))
    await initDatabase({ dbName: join(dir, 't.db'), createSchemaOnInit: true })
    const repo = new MikroOrmUsageEventRepository(() => getEm())

    // 第一次写入
    await repo.batchInsertEvents([makeProxyEvent({ dedupId: 'dup-001' })])
    // 第二次写入相同 dedupId → INSERT OR IGNORE 跳过
    await repo.batchInsertEvents([makeProxyEvent({ dedupId: 'dup-001', agentId: 'codex' })])

    const page = await repo.search({ startSec: 0, endSec: 2000000000 }, {}, undefined, 10)
    expect(page.rows).toHaveLength(1) // 只有第一条
    expect(page.rows[0].agentId).toBe('claude') // 第一次的
  })

  it('不同 dedup_id 都写入', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hxg-repo-dedup2-'))
    await initDatabase({ dbName: join(dir, 't.db'), createSchemaOnInit: true })
    const repo = new MikroOrmUsageEventRepository(() => getEm())

    await repo.batchInsertEvents([
      makeProxyEvent({ dedupId: 'proxy-1' }),
      makeProxyEvent({ dedupId: 'session-1', source: 'session' }),
    ])

    const page = await repo.search({ startSec: 0, endSec: 2000000000 }, {}, undefined, 10)
    expect(page.rows).toHaveLength(2)
  })

  it('summary 聚合数值正确', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hxg-repo-sum-'))
    await initDatabase({ dbName: join(dir, 't.db'), createSchemaOnInit: true })
    const repo = new MikroOrmUsageEventRepository(() => getEm())

    await repo.batchInsertEvents([
      makeProxyEvent({ inputTokens: 1000, outputTokens: 500, totalCostUsd: 0.01 }),
      makeProxyEvent({ dedupId: 'proxy-2', inputTokens: 200, outputTokens: 100, totalCostUsd: 0.005 }),
    ])

    const s = await repo.summary({ startSec: 0, endSec: 2000000000 })
    expect(s.requests).toBe(2)
    expect(s.inputTokens).toBe(1200)
    expect(s.outputTokens).toBe(600)
    expect(s.totalCostUsd).toBeCloseTo(0.015, 5)
  })

  it('modelBreakdown 按 model 分组', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hxg-repo-mb-'))
    await initDatabase({ dbName: join(dir, 't.db'), createSchemaOnInit: true })
    const repo = new MikroOrmUsageEventRepository(() => getEm())

    await repo.batchInsertEvents([
      makeProxyEvent({ model: 'claude-sonnet-4-20250514' }),
      makeProxyEvent({ dedupId: 'p2', model: 'gpt-5-codex', inputTokens: 500, outputTokens: 200 }),
    ])

    const rows = await repo.modelBreakdown({ startSec: 0, endSec: 2000000000 })
    expect(rows).toHaveLength(2)
    const sonnet = rows.find((r) => r.model === 'claude-sonnet-4-20250514')
    expect(sonnet).toBeDefined()
    expect(sonnet!.requests).toBe(1)
  })

  it('agentBreakdown 按 agent 分组', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hxg-repo-ab-'))
    await initDatabase({ dbName: join(dir, 't.db'), createSchemaOnInit: true })
    const repo = new MikroOrmUsageEventRepository(() => getEm())

    await repo.batchInsertEvents([
      makeProxyEvent({ agentId: 'claude' }),
      makeProxyEvent({ dedupId: 'p2', agentId: 'codex' }),
    ])

    const rows = await repo.agentBreakdown({ startSec: 0, endSec: 2000000000 })
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.agentId).sort()).toEqual(['claude', 'codex'])
  })

  it('search 分页：limit+1 判断是否有下一页', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hxg-repo-page-'))
    await initDatabase({ dbName: join(dir, 't.db'), createSchemaOnInit: true })
    const repo = new MikroOrmUsageEventRepository(() => getEm())

    const batch = []
    for (let i = 0; i < 5; i++) {
      batch.push(makeProxyEvent({ dedupId: `p-${i}`, occurredAt: 1700000000 + i }))
    }
    await repo.batchInsertEvents(batch)

    const page1 = await repo.search({ startSec: 0, endSec: 2000000000 }, {}, undefined, 2)
    expect(page1.rows).toHaveLength(2)
    expect(page1.nextCursor).toBeDefined()

    const page2 = await repo.search(
      { startSec: 0, endSec: 2000000000 },
      {},
      page1.nextCursor,
      2,
    )
    expect(page2.rows).toHaveLength(2)
    expect(page2.nextCursor).toBeDefined()

    const page3 = await repo.search(
      { startSec: 0, endSec: 2000000000 },
      {},
      page2.nextCursor,
      2,
    )
    expect(page3.rows).toHaveLength(1)
    expect(page3.nextCursor).toBeUndefined()
  })
})
