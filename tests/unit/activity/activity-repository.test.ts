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
    source_key TEXT PRIMARY KEY, tool TEXT NOT NULL, metric TEXT NOT NULL, occurred_at BIGINT NOT NULL DEFAULT 0
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
    await repo.upsertEvents([{ sourceKey: 'k1', tool: 'claude', metric: 'tool_calls', occurredAt: 1700000000 }])
    await repo.upsertEvents([{ sourceKey: 'k1', tool: 'claude', metric: 'tool_calls', occurredAt: 1700000000 }])
    const conn = testOrm.em.getConnection()
    const rows = (await conn.execute('SELECT COUNT(*) AS n FROM activity_events', [], 'all')) as any[]
    expect(Number(rows[0].n)).toBe(1)
  })

  it('rebuildRollups：按 UTC 日 + tool + metric 计数', async () => {
    const repo = new MikroOrmActivityRepository(testGetEm)
    await repo.upsertEvents([
      { sourceKey: 'a', tool: 'claude', metric: 'tool_calls', occurredAt: 1700000000 }, // 2023-11-14
      { sourceKey: 'b', tool: 'claude', metric: 'tool_calls', occurredAt: 1700000100 }, // 同日
      { sourceKey: 'c', tool: 'codex', metric: 'sessions', occurredAt: 1700000200 },
    ])
    await repo.rebuildRollups()
    const trend = await repo.trend('90d', 'tool_calls')
    expect(trend).toEqual([{ date: '2023-11-14', value: 2 }])
    const sessions = await repo.trend('90d', 'sessions')
    expect(sessions).toEqual([{ date: '2023-11-14', value: 1 }])
  })

  it('rebuildRollups 幂等：跑两次结果不变', async () => {
    const repo = new MikroOrmActivityRepository(testGetEm)
    await repo.upsertEvents([{ sourceKey: 'a', tool: 'claude', metric: 'sessions', occurredAt: 1700000000 }])
    await repo.rebuildRollups()
    await repo.rebuildRollups()
    expect(await repo.trend('90d', 'sessions')).toEqual([{ date: '2023-11-14', value: 1 }])
  })

  it('trend：空表返回 []', async () => {
    const repo = new MikroOrmActivityRepository(testGetEm)
    expect(await repo.trend('7d', 'sessions')).toEqual([])
  })

  it('watermark 读写', async () => {
    const repo = new MikroOrmActivityRepository(testGetEm)
    expect(await repo.readWatermark()).toBe(0)
    await repo.writeWatermark(12345)
    expect(await repo.readWatermark()).toBe(12345)
    await repo.writeWatermark(99999)
    expect(await repo.readWatermark()).toBe(99999)
  })
})
