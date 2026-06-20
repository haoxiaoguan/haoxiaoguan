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

function makeSessionEvent(overrides: Partial<UsageEvent> = {}): UsageEvent {
  return {
    dedupId: 'session:msg_001',
    source: 'session',
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
    occurredAt: 1700000000,
    createdAt: 1700000200,
    ...overrides,
  }
}

describe('MikroOrmUsageEventRepository', () => {
  it('insertProxyEvent 后 search 能查到', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hxg-repo-'))
    await initDatabase({ dbName: join(dir, 't.db'), createSchemaOnInit: true })
    const repo = new MikroOrmUsageEventRepository(() => getEm())

    await repo.insertProxyEvent(makeProxyEvent())
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

  it('session 事件与已有 proxy 事件 dedup_id 相同 → 跳过', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hxg-repo-dedup1-'))
    await initDatabase({ dbName: join(dir, 't.db'), createSchemaOnInit: true })
    const repo = new MikroOrmUsageEventRepository(() => getEm())

    // proxy 事件用 dedupId = 'session:msg_001'（模拟代理已记录了同 message_id）
    await repo.insertProxyEvent(makeProxyEvent({ dedupId: 'session:msg_001', source: 'proxy' }))
    const inserted = await repo.insertSessionEvents([makeSessionEvent({ dedupId: 'session:msg_001' })])
    expect(inserted).toBe(0)

    const page = await repo.search({ startSec: 0, endSec: 2000000000 }, {}, undefined, 10)
    expect(page.rows).toHaveLength(1) // 仍是 proxy 那条
  })

  it('session 事件指纹匹配 proxy 事件 → 跳过', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hxg-repo-dedup2-'))
    await initDatabase({ dbName: join(dir, 't.db'), createSchemaOnInit: true })
    const repo = new MikroOrmUsageEventRepository(() => getEm())

    // proxy 事件 dedupId 不同，但 token + model + 时间窗口匹配
    await repo.insertProxyEvent(
      makeProxyEvent({ dedupId: 'proxy-uuid-abc', source: 'proxy', occurredAt: 1700000000 }),
    )
    // session 事件 dedupId 不同（session:msg_002），但指纹匹配
    const inserted = await repo.insertSessionEvents([
      makeSessionEvent({ dedupId: 'session:msg_002', occurredAt: 1700000100 }),
    ])
    expect(inserted).toBe(0)

    const page = await repo.search({ startSec: 0, endSec: 2000000000 }, {}, undefined, 10)
    expect(page.rows).toHaveLength(1)
  })

  it('session 事件无匹配 → 插入', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hxg-repo-dedup3-'))
    await initDatabase({ dbName: join(dir, 't.db'), createSchemaOnInit: true })
    const repo = new MikroOrmUsageEventRepository(() => getEm())

    const inserted = await repo.insertSessionEvents([makeSessionEvent()])
    expect(inserted).toBe(1)

    const page = await repo.search({ startSec: 0, endSec: 2000000000 }, {}, undefined, 10)
    expect(page.rows).toHaveLength(1)
    expect(page.rows[0].source).toBe('session')
  })

  it('summary 聚合数值正确', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hxg-repo-sum-'))
    await initDatabase({ dbName: join(dir, 't.db'), createSchemaOnInit: true })
    const repo = new MikroOrmUsageEventRepository(() => getEm())

    await repo.insertProxyEvent(makeProxyEvent({ inputTokens: 1000, outputTokens: 500, totalCostUsd: 0.01 }))
    await repo.insertProxyEvent(
      makeProxyEvent({ dedupId: 'proxy-2', inputTokens: 200, outputTokens: 100, totalCostUsd: 0.005 }),
    )

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

    await repo.insertProxyEvent(makeProxyEvent({ model: 'claude-sonnet-4-20250514' }))
    await repo.insertProxyEvent(
      makeProxyEvent({ dedupId: 'p2', model: 'gpt-5-codex', inputTokens: 500, outputTokens: 200 }),
    )

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

    await repo.insertProxyEvent(makeProxyEvent({ agentId: 'claude' }))
    await repo.insertProxyEvent(makeProxyEvent({ dedupId: 'p2', agentId: 'codex' }))

    const rows = await repo.agentBreakdown({ startSec: 0, endSec: 2000000000 })
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.agentId).sort()).toEqual(['claude', 'codex'])
  })

  it('search 分页：limit+1 判断是否有下一页', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hxg-repo-page-'))
    await initDatabase({ dbName: join(dir, 't.db'), createSchemaOnInit: true })
    const repo = new MikroOrmUsageEventRepository(() => getEm())

    for (let i = 0; i < 5; i++) {
      await repo.insertProxyEvent(
        makeProxyEvent({ dedupId: `p-${i}`, occurredAt: 1700000000 + i }),
      )
    }

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
