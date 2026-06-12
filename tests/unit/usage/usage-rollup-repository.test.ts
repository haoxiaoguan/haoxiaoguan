process.env.TZ = 'UTC'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MikroORM } from '@mikro-orm/better-sqlite'
import { ReflectMetadataProvider } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/better-sqlite'
import { MikroOrmUsageRollupRepository } from '../../../src/main/contexts/usage/infrastructure/mikro-orm-usage-rollup-repository'

let testOrm: MikroORM
function testGetEm(): EntityManager { return testOrm.em.fork() }

beforeEach(async () => {
  testOrm = await MikroORM.init({
    metadataProvider: ReflectMetadataProvider,
    dbName: ':memory:', entities: [], entitiesTs: [], debug: false,
    discovery: { warnWhenNoEntities: false, requireEntitiesArray: false },
  })
  const conn = testOrm.em.getConnection()
  await conn.execute(`CREATE TABLE usage_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT, agent_id TEXT, source_kind TEXT,
    occurred_at BIGINT NOT NULL DEFAULT 0,
    input_tokens BIGINT NOT NULL DEFAULT 0, output_tokens BIGINT NOT NULL DEFAULT 0,
    cache_read_tokens BIGINT NOT NULL DEFAULT 0, cache_creation_tokens BIGINT NOT NULL DEFAULT 0
  )`)
  await conn.execute(`CREATE TABLE usage_daily_rollups (
    date TEXT NOT NULL, agent_id TEXT NOT NULL, source_kind TEXT NOT NULL,
    records_count INTEGER NOT NULL DEFAULT 0,
    input_tokens BIGINT NOT NULL DEFAULT 0, output_tokens BIGINT NOT NULL DEFAULT 0,
    cache_read_tokens BIGINT NOT NULL DEFAULT 0, cache_creation_tokens BIGINT NOT NULL DEFAULT 0,
    updated_at BIGINT NOT NULL DEFAULT 0, PRIMARY KEY (date, agent_id, source_kind)
  )`)
})
afterEach(async () => { if (testOrm) await testOrm.close(true) })

describe('MikroOrmUsageRollupRepository – 1d 小时级', () => {
  it('trend 1d：按小时聚合 usage_records', async () => {
    const repo = new MikroOrmUsageRollupRepository(testGetEm)
    const conn = testOrm.em.getConnection()
    await conn.execute(`INSERT INTO usage_records (agent_id, source_kind, occurred_at, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens) VALUES
      ('claude','x',1700000000,10,5,0,0),('claude','x',1700000060,20,5,0,0),('claude','x',1700003600,7,3,0,0)`)
    const pts = await repo.trend({ startSec: 0, endSec: 4102444800 }, 'hour')
    expect(pts.map((p) => ({ date: p.date, input: p.inputTokens, req: p.requests }))).toEqual([
      { date: '2023-11-14 22:00', input: 30, req: 2 },
      { date: '2023-11-14 23:00', input: 7, req: 1 },
    ])
  })
})
