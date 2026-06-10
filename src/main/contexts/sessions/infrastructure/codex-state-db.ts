import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import type { CodexProviderCount, CodexThreadRef } from '../domain/codex-repair'

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

  /** 各 provider 会话数(archived=0),按数量降序。 */
  counts(): CodexProviderCount[] {
    return this.db
      .prepare(`SELECT model_provider AS provider, COUNT(*) AS count FROM threads WHERE archived = 0 GROUP BY model_provider ORDER BY count DESC`)
      .all() as CodexProviderCount[]
  }

  /** 非 target(可选限定 fromProviders)且 archived=0 的 thread 引用(供 rollout 改写)。 */
  listRefs(target: string, fromProviders?: string[]): CodexThreadRef[] {
    const params: unknown[] = [target]
    let sql = `SELECT id, rollout_path AS rolloutPath, model_provider AS provider FROM threads WHERE archived = 0 AND model_provider <> ?`
    if (fromProviders && fromProviders.length > 0) {
      sql += ` AND model_provider IN (${fromProviders.map(() => '?').join(',')})`
      params.push(...fromProviders)
    }
    return this.db.prepare(sql).all(...params) as CodexThreadRef[]
  }

  /** 把非 target(可选限定 fromProviders)的 model_provider 改成 target。返回改动行数。 */
  updateProvider(target: string, fromProviders?: string[]): number {
    const params: unknown[] = [target, target]
    let sql = `UPDATE threads SET model_provider = ? WHERE archived = 0 AND model_provider <> ?`
    if (fromProviders && fromProviders.length > 0) {
      sql += ` AND model_provider IN (${fromProviders.map(() => '?').join(',')})`
      params.push(...fromProviders)
    }
    const info = this.db.prepare(sql).run(...params)
    return info.changes
  }

  close(): void {
    this.db.close()
  }
}
