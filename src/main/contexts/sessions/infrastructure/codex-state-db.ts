import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import type { CodexProviderCount } from '../domain/codex-repair'

const STATE_RE = /^state_(\d+)\.sqlite$/

/** 发现 Codex home 下版本号最大的 state_N.sqlite。无则 undefined。 */
export function findCodexStateDb(codexHome: string): string | undefined {
  if (!existsSync(codexHome)) return undefined
  let best: { n: number; name: string } | undefined
  for (const name of readdirSync(codexHome)) {
    const m = STATE_RE.exec(name)
    if (!m) continue
    const n = Number(m[1])
    if (!best || n > best.n) best = { n, name }
  }
  return best ? join(codexHome, best.name) : undefined
}

export interface ApplyUpdatesResult {
  providerRows: number
  userEventRows: number
  cwdRows: number
}

/** 读写 Codex state_*.sqlite 的 threads 表。同步(better-sqlite3)。用完务必 close()。 */
export class CodexStateDb {
  private readonly db: Database.Database
  constructor(dbPath: string, opts: { readonly?: boolean } = {}) {
    this.db = new Database(dbPath, { readonly: opts.readonly ?? false, fileMustExist: true })
  }

  hasThreadsTable(): boolean {
    const row = this.db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='threads'`)
      .get() as { name: string } | undefined
    return row !== undefined
  }

  /** 检查 threads 表是否含某列（PRAGMA table_info）。 */
  hasColumn(table: string, name: string): boolean {
    const rows = this.db
      .prepare(`PRAGMA table_info("${table.replace(/"/g, '""')}")`)
      .all() as Array<{ name: string }>
    return rows.some((r) => r.name === name)
  }

  /** 各 provider 会话数(全量，含 archived)，按数量降序。 */
  counts(): CodexProviderCount[] {
    return this.db
      .prepare(
        `SELECT model_provider AS provider, COUNT(*) AS count FROM threads GROUP BY model_provider ORDER BY count DESC`,
      )
      .all() as CodexProviderCount[]
  }

  /**
   * 三类更新（对齐 apply_sqlite_update），用 better-sqlite3 事务：
   * ① provider 全量更新
   * ② 若含 has_user_event 列：对每个 id 置 1
   * ③ 若含 cwd 列：对每个 (id, cwd) 更新
   * 返回三类计数。
   */
  applyUpdates(
    target: string,
    userEventThreadIds: string[],
    cwdByThreadId: Record<string, string>,
  ): ApplyUpdatesResult {
    const counts: ApplyUpdatesResult = { providerRows: 0, userEventRows: 0, cwdRows: 0 }
    const hasUserEventCol = this.hasColumn('threads', 'has_user_event')
    const hasCwdCol = this.hasColumn('threads', 'cwd')

    this.db.transaction(() => {
      // ① provider 全量
      counts.providerRows = this.db
        .prepare(`UPDATE threads SET model_provider = ? WHERE COALESCE(model_provider, '') <> ?`)
        .run(target, target).changes

      // ② has_user_event
      if (hasUserEventCol) {
        const stmt = this.db.prepare(
          `UPDATE threads SET has_user_event = 1 WHERE id = ? AND COALESCE(has_user_event, 0) <> 1`,
        )
        for (const id of userEventThreadIds) {
          counts.userEventRows += stmt.run(id).changes
        }
      }

      // ③ cwd
      if (hasCwdCol) {
        const stmt = this.db.prepare(
          `UPDATE threads SET cwd = ? WHERE id = ? AND COALESCE(cwd, '') <> ?`,
        )
        for (const [id, cwd] of Object.entries(cwdByThreadId)) {
          counts.cwdRows += stmt.run(cwd, id, cwd).changes
        }
      }
    })()

    return counts
  }

  /**
   * 只读预估需要更新的总行数（对齐 count_sqlite_updates，用于「已是最新」跳过判断）。
   */
  countUpdates(
    target: string,
    userEventThreadIds: string[],
    cwdByThreadId: Record<string, string>,
  ): number {
    let total = 0

    // provider
    const providerCount = this.db
      .prepare(`SELECT COUNT(*) AS n FROM threads WHERE COALESCE(model_provider, '') <> ?`)
      .get(target) as { n: number }
    total += providerCount.n

    // has_user_event
    if (this.hasColumn('threads', 'has_user_event')) {
      const stmt = this.db.prepare(
        `SELECT COUNT(*) AS n FROM threads WHERE id = ? AND COALESCE(has_user_event, 0) <> 1`,
      )
      for (const id of userEventThreadIds) {
        total += (stmt.get(id) as { n: number }).n
      }
    }

    // cwd
    if (this.hasColumn('threads', 'cwd')) {
      const stmt = this.db.prepare(
        `SELECT COUNT(*) AS n FROM threads WHERE id = ? AND COALESCE(cwd, '') <> ?`,
      )
      for (const [id, cwd] of Object.entries(cwdByThreadId)) {
        total += (stmt.get(id, cwd) as { n: number }).n
      }
    }

    return total
  }

  close(): void {
    this.db.close()
  }
}
