/**
 * per-file 增量游标：MikroOrmUsageFileCursorStore 读写 + 排除哨兵标记，
 * 以及 ClaudeAgentClient reader 据游标跳过 mtime 未变文件 / mtime 变化后重读。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MikroORM } from '@mikro-orm/better-sqlite'
import { ReflectMetadataProvider } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/better-sqlite'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, statSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MikroOrmUsageFileCursorStore } from '../../../src/main/contexts/usage/infrastructure/mikro-orm-usage-file-cursor-store'
import { ClaudeAgentClient } from '../../../src/main/agents/claude/claude-agent'

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
  if (testOrm) await testOrm.close(true)
}

describe('MikroOrmUsageFileCursorStore', () => {
  beforeEach(async () => { await initTestDb() })
  afterEach(async () => { await closeTestDb() })

  it('save + load 往返，按 reader 隔离', async () => {
    const store = new MikroOrmUsageFileCursorStore(testGetEm)
    await store.save('claude', [
      { sourcePath: '/a.jsonl', mtimeMs: 111 },
      { sourcePath: '/b.jsonl', mtimeMs: 222 },
    ])
    await store.save('codex', [{ sourcePath: '/c.jsonl', mtimeMs: 333 }])

    const claude = await store.load('claude')
    expect(claude.get('/a.jsonl')).toBe(111)
    expect(claude.get('/b.jsonl')).toBe(222)
    expect(claude.size).toBe(2)
    expect((await store.load('codex')).get('/c.jsonl')).toBe(333)
  })

  it('再次 save 同一文件 → 更新 mtime', async () => {
    const store = new MikroOrmUsageFileCursorStore(testGetEm)
    await store.save('claude', [{ sourcePath: '/a.jsonl', mtimeMs: 111 }])
    await store.save('claude', [{ sourcePath: '/a.jsonl', mtimeMs: 999 }])
    expect((await store.load('claude')).get('/a.jsonl')).toBe(999)
  })

})

describe('ClaudeAgentClient 增量：跳过 mtime 未变文件', () => {
  let home: string
  let savedHome: string | undefined
  beforeEach(async () => {
    await initTestDb()
    home = mkdtempSync(join(tmpdir(), 'claude-incr-home-'))
    savedHome = process.env.HOME
    process.env.HOME = home
  })
  afterEach(async () => {
    process.env.HOME = savedHome
    rmSync(home, { recursive: true, force: true })
    await closeTestDb()
  })

  it('首扫入库→保存游标→再扫跳过(0)→mtime 变化后重新产出', async () => {
    const store = new MikroOrmUsageFileCursorStore(testGetEm)
    const file = join(home, '.claude', 'projects', 'p', 'a.jsonl')
    mkdirSync(join(file, '..'), { recursive: true })
    const line = JSON.stringify({
      type: 'assistant',
      timestamp: '2026-05-10T00:00:00Z',
      sessionId: 's1',
      message: { id: 'msg_1', model: 'claude-opus-4-8', stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } },
    })
    writeFileSync(file, line)

    const reader = new ClaudeAgentClient(store).asSessionLogReader()!

    // 首扫：产出 1 条 + processedFiles 1 个
    const b1 = await reader.readUsageMetrics(null)
    expect(b1.records.length).toBe(1)
    expect(b1.processedFiles?.length).toBe(1)
    // 模拟同步服务在 upsert 成功后推进游标
    await store.save('claude', b1.processedFiles!)

    // 再扫：文件未变 → 跳过，0 条
    const b2 = await reader.readUsageMetrics(null)
    expect(b2.records.length).toBe(0)

    // mtime 变化 → 重新产出
    const mt = statSync(file).mtimeMs
    utimesSync(file, new Date(), new Date(mt + 60_000))
    const b3 = await reader.readUsageMetrics(null)
    expect(b3.records.length).toBe(1)
  })
})
