/**
 * MikroORM 实现的 UsageFileCursorStore —— 复用 usage_sync_state 表存 per-file 增量游标：
 *   reader_name + source_path(=文件绝对路径) + last_modified_ns(此处存 mtime 毫秒) + updated_at
 * 两个哨兵 source_path 是「同步结果标记」(见 mikro-orm-usage-sync-state-repository.ts)，
 * load 时必须排除，避免被当成文件游标。
 */
import type { EntityManager } from '@mikro-orm/better-sqlite'
import { getEm as defaultGetEm } from '../../../platform/persistence/database'
import type {
  UsageFileCursorStore,
  ProcessedFileCursor,
} from '../../../agents/shared/usage-file-cursor-store'

const MARKER_STATUS = '__usage_sync_result_status__'
const MARKER_SUCCESS_AT = '__usage_sync_result_success_at__'

export class MikroOrmUsageFileCursorStore implements UsageFileCursorStore {
  private readonly getEm: () => EntityManager

  constructor(getEmFn?: () => EntityManager) {
    this.getEm = getEmFn ?? defaultGetEm
  }

  async load(readerName: string): Promise<Map<string, number>> {
    const conn = this.getEm().getConnection()
    const rows = (await conn.execute(
      `SELECT source_path, last_modified_ns FROM usage_sync_state
       WHERE reader_name = ? AND source_path NOT IN (?, ?)`,
      [readerName, MARKER_STATUS, MARKER_SUCCESS_AT],
      'all',
    )) as Array<{ source_path: string; last_modified_ns: number }>
    const map = new Map<string, number>()
    for (const r of rows ?? []) map.set(String(r.source_path), Number(r.last_modified_ns ?? 0))
    return map
  }

  async save(readerName: string, entries: ProcessedFileCursor[]): Promise<void> {
    if (entries.length === 0) return
    const conn = this.getEm().getConnection()
    const now = Math.floor(Date.now() / 1000)
    const CHUNK = 200
    for (let i = 0; i < entries.length; i += CHUNK) {
      const chunk = entries.slice(i, i + CHUNK)
      await conn.execute('BEGIN')
      try {
        for (const e of chunk) {
          await conn.execute(
            `INSERT INTO usage_sync_state (reader_name, source_path, last_offset, last_modified_ns, last_cursor, updated_at)
             VALUES (?, ?, 0, ?, NULL, ?)
             ON CONFLICT(reader_name, source_path) DO UPDATE SET
               last_modified_ns = excluded.last_modified_ns,
               updated_at = excluded.updated_at`,
            [readerName, e.sourcePath, e.mtimeMs, now],
          )
        }
        await conn.execute('COMMIT')
      } catch (err) {
        await conn.execute('ROLLBACK')
        throw err
      }
      await new Promise((resolve) => setImmediate(resolve))
    }
  }
}
