/**
 * 一次性迁移：把 usage_records 历史数据导入 usage_events。
 *
 * usage_events 是新表，只有部署 analytics 后才开始写入。
 * 老的 usage_records 里有历史数据，需要迁移过来。
 *
 * 幂等：用 analytics_meta 表的 'usage_records_migrated' 标志位防止重复迁移。
 * 迁移按 agent_id 分批，每批 500 条，避免一次性加载过多。
 */
import type { EntityManager } from '@mikro-orm/better-sqlite'
import { getEm as defaultGetEm } from '../../../platform/persistence/database'
import { buildPricingIndex, calculateForAgent } from '../domain/usage-pricing'
import type { ModelPricingRow, PricingConfig, UsageEvent } from '../domain/usage-event'
import type { MikroOrmPricingRepository } from './mikro-orm-pricing-repository'

export async function migrateUsageRecords(
  pricingRepo: MikroOrmPricingRepository,
  getEmFn?: () => EntityManager,
): Promise<number> {
  const getEm = getEmFn ?? defaultGetEm
  const conn = getEm().getConnection()

  // 检查是否已迁移
  let metaExists = false
  try {
    const row = (await conn.execute(
      `SELECT value FROM analytics_meta WHERE key = 'usage_records_migrated'`,
      [],
      'get',
    )) as { value: string } | undefined
    metaExists = row !== undefined && row.value === '1'
  } catch {
    // analytics_meta 表可能不存在，创建它
    try {
      await conn.execute(
        `CREATE TABLE IF NOT EXISTS analytics_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
      )
    } catch {
      // 忽略已存在
    }
  }
  if (metaExists) {
    console.log('[analytics] usage_records already migrated, skipping')
    return 0
  }

  // 检查 usage_records 表是否存在
  try {
    await conn.execute(`SELECT 1 FROM usage_records LIMIT 1`)
  } catch {
    console.log('[analytics] usage_records table not found, skipping migration')
    return 0
  }

  // 加载定价索引和配置缓存
  const pricingRows = await pricingRepo.listPricing()
  const index = buildPricingIndex(pricingRows)
  const configCache = new Map<string, PricingConfig>()

  // 统计总数
  const countRow = (await conn.execute(`SELECT COUNT(*) AS n FROM usage_records`, [], 'get')) as { n: number }
  const total = Number(countRow.n)
  if (total === 0) {
    // 标记已迁移
    await conn.execute(
      `INSERT OR REPLACE INTO analytics_meta (key, value) VALUES ('usage_records_migrated', '1')`,
    )
    console.log('[analytics] usage_records is empty, marking as migrated')
    return 0
  }

  console.log(`[analytics] migrating ${total} records from usage_records to usage_events`)

  // 分批读取并写入
  const BATCH = 500
  let migrated = 0
  let offset = 0

  while (offset < total) {
    const rows = (await conn.execute(
      `SELECT agent_id, source_event_id, session_id, model, provider_name,
              input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
              occurred_at
       FROM usage_records
       ORDER BY id ASC
       LIMIT ? OFFSET ?`,
      [BATCH, offset],
      'all',
    )) as Array<Record<string, unknown>>

    if (rows.length === 0) break

    const now = Math.floor(Date.now() / 1000)
    const values: unknown[] = []
    const placeholders: string[] = []

    for (const r of rows) {
      const agentId = String(r.agent_id)
      const sourceEventId = r.source_event_id != null ? String(r.source_event_id) : ''
      const model = r.model != null ? String(r.model) : ''
      const inputTokens = Number(r.input_tokens ?? 0)
      const outputTokens = Number(r.output_tokens ?? 0)
      const cacheReadTokens = Number(r.cache_read_tokens ?? 0)
      const cacheCreationTokens = Number(r.cache_creation_tokens ?? 0)
      const occurredAt = Number(r.occurred_at)

      // cost 计算
      let config = configCache.get(agentId)
      if (config === undefined) {
        config = await pricingRepo.getConfig(agentId)
        configCache.set(agentId, config)
      }
      const cost = calculateForAgent(
        agentId,
        model,
        { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens },
        index,
        config,
      )

      const dedupId = sourceEventId ? `session:${sourceEventId}` : `migrate:${offset}:${migrated}`
      placeholders.push('(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      values.push(
        dedupId,
        'session',
        agentId,
        model || null,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheCreationTokens,
        cost.inputCostUsd,
        cost.outputCostUsd,
        cost.cacheReadCostUsd,
        cost.cacheCreationCostUsd,
        cost.totalCostUsd,
        r.session_id != null ? String(r.session_id) : null,
        occurredAt,
        now,
      )
      migrated++
    }

    // 批量插入，忽略冲突
    if (placeholders.length > 0) {
      const sql = `INSERT OR IGNORE INTO usage_events (
        dedup_id, source, agent_id, model,
        input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
        input_cost_usd, output_cost_usd, cache_read_cost_usd, cache_creation_cost_usd, total_cost_usd,
        session_id, occurred_at, created_at
      ) VALUES ${placeholders.join(', ')}`
      await conn.execute(sql, values)
    }

    offset += BATCH
    console.log(`[analytics] migration progress: ${migrated}/${total}`)

    // 让出事件循环
    await new Promise((resolve) => setImmediate(resolve))
  }

  // 标记已迁移
  await conn.execute(
    `INSERT OR REPLACE INTO analytics_meta (key, value) VALUES ('usage_records_migrated', '1')`,
  )

  console.log(`[analytics] migration complete: ${migrated} records migrated`)
  return migrated
}
