/**
 * MikroORM-backed implementation of UsageRecordRepository.
 * Upserts on conflict (agent_id, source_kind, source_path, source_event_id).
 * Uses raw SQL via the underlying connection because MikroORM's upsert helper
 * for better-sqlite3 does not expose ON CONFLICT DO UPDATE cleanly for bulk ops.
 */
import type { EntityManager } from '@mikro-orm/better-sqlite'
import { getEm as defaultGetEm } from '../../../platform/persistence/database'
import type { UsageRecordRepository } from '../domain/usage-repositories'
import type { UsageRecord } from '../domain/usage-record'

export class MikroOrmUsageRecordRepository implements UsageRecordRepository {
  private readonly getEm: () => EntityManager

  constructor(getEmFn?: () => EntityManager) {
    this.getEm = getEmFn ?? defaultGetEm
  }

  async upsertMany(records: UsageRecord[]): Promise<number> {
    if (records.length === 0) return 0

    const em = this.getEm()
    const conn = em.getConnection()
    const nowUnix = Math.floor(Date.now() / 1000)

    const sql = `
      INSERT INTO usage_records (
        agent_id, source_kind, source_path, source_event_id,
        session_id, model, provider_name,
        input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
        occurred_at, raw_updated_at, raw_hash, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(agent_id, source_kind, source_path, source_event_id) DO UPDATE SET
        session_id = excluded.session_id,
        model = excluded.model,
        provider_name = excluded.provider_name,
        input_tokens = excluded.input_tokens,
        output_tokens = excluded.output_tokens,
        cache_read_tokens = excluded.cache_read_tokens,
        cache_creation_tokens = excluded.cache_creation_tokens,
        occurred_at = excluded.occurred_at,
        raw_updated_at = excluded.raw_updated_at,
        raw_hash = excluded.raw_hash
    `

    for (const r of records) {
      await conn.execute(sql, [
        r.agentId,
        r.sourceKind,
        r.sourcePath,
        r.sourceEventId,
        r.sessionId ?? null,
        r.model,
        r.providerName ?? null,
        r.inputTokens,
        r.outputTokens,
        r.cacheReadTokens,
        r.cacheCreationTokens,
        r.occurredAt,
        r.rawUpdatedAt,
        r.rawHash,
        nowUnix,
      ])
    }

    return records.length
  }
}
