/**
 * MikroORM-backed implementation of UsageSyncStateRepository.
 * Uses sentinel source_path values as status markers (mirrors Rust impl exactly).
 * Accepts an optional getEm factory for testability.
 */
import type { EntityManager } from '@mikro-orm/better-sqlite'
import { getEm as defaultGetEm } from '../../../platform/persistence/database'
import type { UsageSyncStateRepository } from '../domain/usage-repositories'
import type { UsageSyncResultState } from '../domain/usage-record'

const SYNC_RESULT_STATUS_MARKER_PATH = '__usage_sync_result_status__'
const SYNC_RESULT_SUCCESS_AT_MARKER_PATH = '__usage_sync_result_success_at__'
const STATUS_SUCCESS = 'success'
const STATUS_FAILED = 'failed'

export class MikroOrmUsageSyncStateRepository implements UsageSyncStateRepository {
  private readonly getEm: () => EntityManager

  constructor(getEmFn?: () => EntityManager) {
    this.getEm = getEmFn ?? defaultGetEm
  }

  async saveSyncResult(
    succeededReaders: string[],
    failedReaders: string[],
    updatedAt: number,
  ): Promise<void> {
    const conn = this.getEm().getConnection()

    for (const reader of succeededReaders) {
      await conn.execute(
        `INSERT INTO usage_sync_state (reader_name, source_path, last_offset, last_modified_ns, last_cursor, updated_at)
         VALUES (?, ?, 0, 0, ?, ?)
         ON CONFLICT(reader_name, source_path) DO UPDATE SET
           last_cursor = excluded.last_cursor,
           updated_at = excluded.updated_at`,
        [reader, SYNC_RESULT_STATUS_MARKER_PATH, STATUS_SUCCESS, updatedAt],
      )
      await conn.execute(
        `INSERT INTO usage_sync_state (reader_name, source_path, last_offset, last_modified_ns, last_cursor, updated_at)
         VALUES (?, ?, 0, 0, NULL, ?)
         ON CONFLICT(reader_name, source_path) DO UPDATE SET
           updated_at = excluded.updated_at`,
        [reader, SYNC_RESULT_SUCCESS_AT_MARKER_PATH, updatedAt],
      )
    }

    for (const reader of failedReaders) {
      await conn.execute(
        `INSERT INTO usage_sync_state (reader_name, source_path, last_offset, last_modified_ns, last_cursor, updated_at)
         VALUES (?, ?, 0, 0, ?, ?)
         ON CONFLICT(reader_name, source_path) DO UPDATE SET
           last_cursor = excluded.last_cursor,
           updated_at = excluded.updated_at`,
        [reader, SYNC_RESULT_STATUS_MARKER_PATH, STATUS_FAILED, updatedAt],
      )
    }
  }

  async latestSuccessfulSyncAt(): Promise<number | null> {
    const conn = this.getEm().getConnection()
    const row = (await conn.execute(
      `SELECT MAX(updated_at) AS m FROM usage_sync_state WHERE source_path = ?`,
      [SYNC_RESULT_SUCCESS_AT_MARKER_PATH],
      'get',
    )) as any
    if (!row || row.m == null) return null
    return Number(row.m)
  }

  async listSyncResultStates(): Promise<UsageSyncResultState[]> {
    const conn = this.getEm().getConnection()
    const rows = (await conn.execute(
      `SELECT reader_name, last_cursor, updated_at FROM usage_sync_state WHERE source_path = ?`,
      [SYNC_RESULT_STATUS_MARKER_PATH],
      'all',
    )) as any[]
    return (rows ?? []).map((row: any) => ({
      readerName: row.reader_name ?? '',
      status: row.last_cursor ?? '',
      updatedAt: Number(row.updated_at ?? 0),
    }))
  }
}
