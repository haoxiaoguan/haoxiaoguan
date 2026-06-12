/**
 * Repository round-trip tests using an in-memory SQLite database.
 * Tests: UsageRecordRepository upsert dedup, UsageSyncStateRepository sentinel rows,
 * UsageRollupRepository rebuild + summary/trend/platformBreakdown.
 *
 * Each repository accepts an optional getEm factory — tests pass their own
 * factory backed by an in-memory MikroORM instance, avoiding the global ORM
 * singleton and its entity-glob discovery (which cannot load .ts files at runtime).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MikroORM } from '@mikro-orm/better-sqlite'
import { ReflectMetadataProvider } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/better-sqlite'
import { MikroOrmUsageRecordRepository } from '../../../src/main/contexts/usage/infrastructure/mikro-orm-usage-record-repository'
import { MikroOrmUsageRollupRepository } from '../../../src/main/contexts/usage/infrastructure/mikro-orm-usage-rollup-repository'
import { MikroOrmUsageSyncStateRepository } from '../../../src/main/contexts/usage/infrastructure/mikro-orm-usage-sync-state-repository'
import { UsageRecord } from '../../../src/main/contexts/usage/domain/usage-record'

let testOrm: MikroORM

function testGetEm(): EntityManager {
  return testOrm.em.fork()
}

async function initTestDb(): Promise<void> {
  testOrm = await MikroORM.init({
    metadataProvider: ReflectMetadataProvider,
    dbName: ':memory:',
    entities: [],
    entitiesTs: [],
    debug: false,
    discovery: { warnWhenNoEntities: false, requireEntitiesArray: false },
  })

  const conn = testOrm.em.getConnection()
  await conn.execute('PRAGMA foreign_keys = ON')

  await conn.execute(`
    CREATE TABLE IF NOT EXISTS usage_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      source_kind TEXT,
      source_path TEXT,
      source_event_id TEXT,
      session_id TEXT,
      model TEXT,
      provider_name TEXT,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
      occurred_at BIGINT NOT NULL DEFAULT 0,
      raw_updated_at BIGINT NOT NULL DEFAULT 0,
      raw_hash TEXT,
      created_at BIGINT NOT NULL DEFAULT 0,
      UNIQUE(agent_id, source_kind, source_path, source_event_id)
    )
  `)
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS usage_daily_rollups (
      date TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      records_count INTEGER NOT NULL DEFAULT 0,
      input_tokens BIGINT NOT NULL DEFAULT 0,
      output_tokens BIGINT NOT NULL DEFAULT 0,
      cache_read_tokens BIGINT NOT NULL DEFAULT 0,
      cache_creation_tokens BIGINT NOT NULL DEFAULT 0,
      updated_at BIGINT NOT NULL DEFAULT 0,
      PRIMARY KEY (date, agent_id, source_kind)
    )
  `)
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS usage_sync_state (
      reader_name TEXT NOT NULL,
      source_path TEXT NOT NULL,
      last_offset BIGINT NOT NULL DEFAULT 0,
      last_modified_ns BIGINT NOT NULL DEFAULT 0,
      last_cursor TEXT,
      updated_at BIGINT NOT NULL DEFAULT 0,
      PRIMARY KEY (reader_name, source_path)
    )
  `)
}

async function closeTestDb(): Promise<void> {
  if (testOrm) {
    await testOrm.close(true)
  }
}

function makeRecord(overrides: Partial<Parameters<typeof UsageRecord.create>[0]> = {}): UsageRecord {
  return UsageRecord.create({
    agentId: 'claude',
    sourceKind: 'session',
    sourcePath: '/tmp/test.jsonl',
    sourceEventId: '/tmp/test.jsonl:0',
    model: 'claude-3-5-sonnet',
    providerName: 'anthropic',
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 10,
    cacheCreationTokens: 5,
    occurredAt: 1700000000, // 2023-11-14
    rawUpdatedAt: 1700000001,
    rawHash: UsageRecord.computeHash('/tmp/test.jsonl:0'),
    ...overrides,
  })
}

describe('MikroOrmUsageRecordRepository', () => {
  beforeEach(async () => { await initTestDb() })
  afterEach(async () => { await closeTestDb() })

  it('upserts records and returns count', async () => {
    const repo = new MikroOrmUsageRecordRepository(testGetEm)
    const count = await repo.upsertMany([
      makeRecord(),
      makeRecord({ sourceEventId: '/tmp/test.jsonl:1', inputTokens: 200 }),
    ])
    expect(count).toBe(2)
  })

  it('deduplicates on conflict key — second upsert updates token fields', async () => {
    const repo = new MikroOrmUsageRecordRepository(testGetEm)
    await repo.upsertMany([makeRecord()])
    await repo.upsertMany([makeRecord({ inputTokens: 999, rawHash: 'newhash' })])

    const conn = testOrm.em.getConnection()
    const rows = (await conn.execute('SELECT * FROM usage_records', [], 'all')) as any[]
    expect(rows).toHaveLength(1)
    expect(Number(rows[0].input_tokens)).toBe(999)
    expect(rows[0].raw_hash).toBe('newhash')
  })

  it('returns 0 for empty batch', async () => {
    const repo = new MikroOrmUsageRecordRepository(testGetEm)
    expect(await repo.upsertMany([])).toBe(0)
  })
})

describe('MikroOrmUsageSyncStateRepository', () => {
  beforeEach(async () => { await initTestDb() })
  afterEach(async () => { await closeTestDb() })

  it('latestSuccessfulSyncAt returns null when no sync has run', async () => {
    const repo = new MikroOrmUsageSyncStateRepository(testGetEm)
    expect(await repo.latestSuccessfulSyncAt()).toBeNull()
  })

  it('listSyncResultStates returns empty array initially', async () => {
    const repo = new MikroOrmUsageSyncStateRepository(testGetEm)
    expect(await repo.listSyncResultStates()).toEqual([])
  })

  it('saveSyncResult writes success markers and latestSuccessfulSyncAt returns timestamp', async () => {
    const repo = new MikroOrmUsageSyncStateRepository(testGetEm)
    const ts = 1700000000
    await repo.saveSyncResult(['claude', 'codex'], [], ts)

    const latest = await repo.latestSuccessfulSyncAt()
    expect(latest).toBe(ts)

    const states = await repo.listSyncResultStates()
    expect(states).toHaveLength(2)
    const claudeState = states.find((s) => s.readerName === 'claude')
    expect(claudeState?.status).toBe('success')
  })

  it('saveSyncResult writes failed markers', async () => {
    const repo = new MikroOrmUsageSyncStateRepository(testGetEm)
    await repo.saveSyncResult([], ['kiro'], 1700000000)

    const states = await repo.listSyncResultStates()
    expect(states).toHaveLength(1)
    expect(states[0].readerName).toBe('kiro')
    expect(states[0].status).toBe('failed')
  })

  it('second saveSyncResult overwrites status for same reader', async () => {
    const repo = new MikroOrmUsageSyncStateRepository(testGetEm)
    await repo.saveSyncResult(['claude'], [], 1700000000)
    await repo.saveSyncResult([], ['claude'], 1700000001)

    const states = await repo.listSyncResultStates()
    const claudeState = states.find((s) => s.readerName === 'claude')
    expect(claudeState?.status).toBe('failed')
  })
})

describe('MikroOrmUsageRollupRepository', () => {
  beforeEach(async () => { await initTestDb() })
  afterEach(async () => { await closeTestDb() })

  it('summary returns zeros when rollup table is empty', async () => {
    const repo = new MikroOrmUsageRollupRepository(testGetEm)
    const s = await repo.summary({ startSec: 0, endSec: 4102444800 })
    expect(s.inputTokens).toBe(0)
    expect(s.outputTokens).toBe(0)
    expect(s.requests).toBe(0)
  })

  it('trend returns empty array when rollup table is empty', async () => {
    const repo = new MikroOrmUsageRollupRepository(testGetEm)
    expect(await repo.trend({ startSec: 0, endSec: 4102444800 }, 'day', 'tokens')).toEqual([])
  })

  it('platformBreakdown returns empty array when rollup table is empty', async () => {
    const repo = new MikroOrmUsageRollupRepository(testGetEm)
    expect(await repo.platformBreakdown({ startSec: 0, endSec: 4102444800 })).toEqual([])
  })

  it('rebuildAll populates rollup from usage_records', async () => {
    const recordRepo = new MikroOrmUsageRecordRepository(testGetEm)
    await recordRepo.upsertMany([makeRecord()])

    const rollupRepo = new MikroOrmUsageRollupRepository(testGetEm)
    await rollupRepo.rebuildAll()

    const s = await rollupRepo.summary({ startSec: 0, endSec: 4102444800 })
    expect(s.inputTokens).toBe(100)
    expect(s.outputTokens).toBe(50)
    expect(s.requests).toBe(1)
  })

  it('rebuildAll is idempotent — running twice gives same result', async () => {
    const recordRepo = new MikroOrmUsageRecordRepository(testGetEm)
    await recordRepo.upsertMany([makeRecord()])

    const rollupRepo = new MikroOrmUsageRollupRepository(testGetEm)
    await rollupRepo.rebuildAll()
    await rollupRepo.rebuildAll()

    const s = await rollupRepo.summary({ startSec: 0, endSec: 4102444800 })
    expect(s.inputTokens).toBe(100)
  })

  it('platformBreakdown groups by agent_id', async () => {
    const recordRepo = new MikroOrmUsageRecordRepository(testGetEm)
    await recordRepo.upsertMany([
      makeRecord({ agentId: 'claude', inputTokens: 100, outputTokens: 50 }),
      makeRecord({
        agentId: 'codex',
        sourceEventId: '/tmp/test.jsonl:1',
        inputTokens: 200,
        outputTokens: 100,
      }),
    ])

    const rollupRepo = new MikroOrmUsageRollupRepository(testGetEm)
    await rollupRepo.rebuildAll()

    const breakdown = await rollupRepo.platformBreakdown({ startSec: 0, endSec: 4102444800 })
    expect(breakdown).toHaveLength(2)
    // codex has higher total (300), should be first
    expect(breakdown[0].platform).toBe('codex')
    expect(breakdown[1].platform).toBe('claude')
  })
})
