import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { initDatabase, getEm, closeDatabase } from '../../../../src/main/platform/persistence/database'

afterEach(async () => {
  await closeDatabase()
})

describe('usage_events 实体建表', () => {
  it('createSchema 后 usage_events 表存在且字段完整', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hxg-analytics-'))
    const dbFile = join(dir, 'test.db')
    await initDatabase({ dbName: dbFile, createSchemaOnInit: true })
    const conn = getEm().getConnection()

    const cols = (await conn.execute('PRAGMA table_info(usage_events)', [], 'all')) as Array<{
      name: string
      type: string
      notnull: number
      pk: number
    }>
    const colNames = cols.map((c) => c.name)
    // 标识字段
    expect(colNames).toContain('id')
    expect(colNames).toContain('dedup_id')
    expect(colNames).toContain('source')
    expect(colNames).toContain('agent_id')
    // token 字段
    expect(colNames).toContain('input_tokens')
    expect(colNames).toContain('output_tokens')
    expect(colNames).toContain('cache_read_tokens')
    expect(colNames).toContain('cache_creation_tokens')
    // cost 字段
    expect(colNames).toContain('input_cost_usd')
    expect(colNames).toContain('output_cost_usd')
    expect(colNames).toContain('cache_read_cost_usd')
    expect(colNames).toContain('cache_creation_cost_usd')
    expect(colNames).toContain('total_cost_usd')
    // 请求级细节
    expect(colNames).toContain('status')
    expect(colNames).toContain('duration_ms')
    expect(colNames).toContain('ttfb_ms')
    expect(colNames).toContain('error_kind')
    expect(colNames).toContain('account_id')
    expect(colNames).toContain('client_key_id')
    expect(colNames).toContain('combo_name')
    expect(colNames).toContain('session_id')
    expect(colNames).toContain('requested_model')
    // 时间字段
    expect(colNames).toContain('occurred_at')
    expect(colNames).toContain('created_at')

    // id 是主键
    const pk = cols.filter((c) => c.pk > 0).map((c) => c.name)
    expect(pk).toEqual(['id'])
  })

  it('索引存在', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hxg-analytics-idx-'))
    const dbFile = join(dir, 'test.db')
    await initDatabase({ dbName: dbFile, createSchemaOnInit: true })
    const conn = getEm().getConnection()

    const indexes = (await conn.execute('PRAGMA index_list(usage_events)', [], 'all')) as Array<{
      name: string
    }>
    const indexNames = indexes.map((i) => i.name)
    // 至少有主键索引 + 我们定义的 4 个索引
    expect(indexNames.length).toBeGreaterThanOrEqual(4)
  })
})
