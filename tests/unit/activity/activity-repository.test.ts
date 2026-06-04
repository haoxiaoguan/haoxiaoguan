import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MikroORM } from '@mikro-orm/better-sqlite'
import { ReflectMetadataProvider } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/better-sqlite'
import { MikroOrmActivityRepository } from '../../../src/main/contexts/activity/infrastructure/mikro-orm-activity-repository'

let testOrm: MikroORM
function testGetEm(): EntityManager { return testOrm.em.fork() }

beforeEach(async () => {
  testOrm = await MikroORM.init({
    metadataProvider: ReflectMetadataProvider,
    dbName: ':memory:', entities: [], entitiesTs: [], debug: false,
    discovery: { warnWhenNoEntities: false, requireEntitiesArray: false },
  })
  const conn = testOrm.em.getConnection()
  await conn.execute(`CREATE TABLE activity_events (
    source_key TEXT NOT NULL, metric TEXT NOT NULL, tool TEXT NOT NULL,
    occurred_at BIGINT NOT NULL DEFAULT 0, amount INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (source_key, metric)
  )`)
  await conn.execute(`CREATE TABLE activity_daily_rollups (
    date TEXT NOT NULL, tool TEXT NOT NULL, metric TEXT NOT NULL,
    value INTEGER NOT NULL DEFAULT 0, updated_at BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (date, tool, metric)
  )`)
  await conn.execute(`CREATE TABLE activity_scan_state (
    id TEXT PRIMARY KEY, last_scan_at BIGINT NOT NULL DEFAULT 0
  )`)
})
afterEach(async () => { if (testOrm) await testOrm.close(true) })

describe('MikroOrmActivityRepository', () => {
  it('upsertEvents 幂等：相同 source_key 第二次不增行', async () => {
    const repo = new MikroOrmActivityRepository(testGetEm)
    await repo.upsertEvents([{ sourceKey: 'k1', tool: 'claude', metric: 'tool_calls', occurredAt: 1700000000, amount: 1 }])
    await repo.upsertEvents([{ sourceKey: 'k1', tool: 'claude', metric: 'tool_calls', occurredAt: 1700000000, amount: 1 }])
    const conn = testOrm.em.getConnection()
    const rows = (await conn.execute('SELECT COUNT(*) AS n FROM activity_events', [], 'all')) as any[]
    expect(Number(rows[0].n)).toBe(1)
  })

  it('rebuildRollups：按 UTC 日 + tool + metric 计数', async () => {
    const repo = new MikroOrmActivityRepository(testGetEm)
    await repo.upsertEvents([
      { sourceKey: 'a', tool: 'claude', metric: 'tool_calls', occurredAt: 1700000000, amount: 1 }, // 2023-11-14
      { sourceKey: 'b', tool: 'claude', metric: 'tool_calls', occurredAt: 1700000100, amount: 1 }, // 同日
      { sourceKey: 'c', tool: 'codex', metric: 'sessions', occurredAt: 1700000200, amount: 1 },
    ])
    await repo.rebuildRollups()
    const trend = await repo.trend('90d', 'tool_calls')
    expect(trend).toEqual([{ date: '2023-11-14', value: 2 }])
    const sessions = await repo.trend('90d', 'sessions')
    expect(sessions).toEqual([{ date: '2023-11-14', value: 1 }])
  })

  it('rebuildRollups 幂等：跑两次结果不变', async () => {
    const repo = new MikroOrmActivityRepository(testGetEm)
    await repo.upsertEvents([{ sourceKey: 'a', tool: 'claude', metric: 'sessions', occurredAt: 1700000000, amount: 1 }])
    await repo.rebuildRollups()
    await repo.rebuildRollups()
    expect(await repo.trend('90d', 'sessions')).toEqual([{ date: '2023-11-14', value: 1 }])
  })

  it('trend：空表返回 []', async () => {
    const repo = new MikroOrmActivityRepository(testGetEm)
    expect(await repo.trend('7d', 'sessions')).toEqual([])
  })

  it('rebuildRollups：code_lines 按 amount 求和（非计数）', async () => {
    const repo = new MikroOrmActivityRepository(testGetEm)
    await repo.upsertEvents([
      { sourceKey: 'e1', tool: 'claude', metric: 'code_lines', occurredAt: 1700000000, amount: 10 },
      { sourceKey: 'e2', tool: 'claude', metric: 'code_lines', occurredAt: 1700000100, amount: 5 },
    ])
    await repo.rebuildRollups()
    expect(await repo.trend('90d', 'code_lines')).toEqual([{ date: '2023-11-14', value: 15 }])
  })

  it('同一 source_key 不同 metric 可共存（复合主键）', async () => {
    const repo = new MikroOrmActivityRepository(testGetEm)
    await repo.upsertEvents([
      { sourceKey: 'u#0', tool: 'claude', metric: 'tool_calls', occurredAt: 1700000000, amount: 1 },
      { sourceKey: 'u#0', tool: 'claude', metric: 'code_lines', occurredAt: 1700000000, amount: 7 },
    ])
    const conn = testOrm.em.getConnection()
    const rows = (await conn.execute('SELECT COUNT(*) AS n FROM activity_events', [], 'all')) as any[]
    expect(Number(rows[0].n)).toBe(2)
  })

  it('watermark 读写', async () => {
    const repo = new MikroOrmActivityRepository(testGetEm)
    expect(await repo.readWatermark()).toBe(0)
    await repo.writeWatermark(12345)
    expect(await repo.readWatermark()).toBe(12345)
    await repo.writeWatermark(99999)
    expect(await repo.readWatermark()).toBe(99999)
  })

  it('trend 1d：按小时分桶，锚最近有数据的那天', async () => {
    const repo = new MikroOrmActivityRepository(testGetEm)
    await repo.upsertEvents([
      { sourceKey: 's1', tool: 'claude', metric: 'tool_calls', occurredAt: 1700000000, amount: 1 },
      { sourceKey: 's2', tool: 'claude', metric: 'tool_calls', occurredAt: 1700000060, amount: 1 },
      { sourceKey: 's3', tool: 'claude', metric: 'tool_calls', occurredAt: 1700003600, amount: 1 },
    ])
    await repo.rebuildRollups()
    const pts = await repo.trend('1d', 'tool_calls')
    expect(pts).toEqual([
      { date: '2023-11-14 22:00', value: 2 },
      { date: '2023-11-14 23:00', value: 1 },
    ])
  })
})
