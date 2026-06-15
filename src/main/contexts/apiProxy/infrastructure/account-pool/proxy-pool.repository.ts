/**
 * 反代账号池成员仓储（MikroORM/better-sqlite，原生 SQL）。
 * add 用 INSERT OR IGNORE 幂等；列名 account_id / priority / created_at 与实体一致。
 * priority 为选号权重优先级（默认 0），随实体由 updateSchema 在存量库上自动补列。
 */
import type { EntityManager } from '@mikro-orm/better-sqlite'
import { getEm as defaultGetEm } from '../../../../platform/persistence/database'

/* eslint-disable @typescript-eslint/no-explicit-any */

/** 默认每账号并发上限（新成员/未设置时）。 */
export const DEFAULT_PROXY_POOL_CONCURRENCY = 4

/** 池成员（含优先级 + 并发上限）。 */
export interface ProxyPoolMemberRow {
  accountId: string
  priority: number
  concurrency: number
}

export class ProxyPoolRepository {
  private readonly getEm: () => EntityManager

  constructor(getEmFn?: () => EntityManager) {
    this.getEm = getEmFn ?? defaultGetEm
  }

  /** 列出全部成员（含优先级 + 并发上限）。 */
  async list(): Promise<ProxyPoolMemberRow[]> {
    const conn = this.getEm().getConnection()
    const rows = (await conn.execute(
      'SELECT account_id, priority, concurrency FROM proxy_pool_members ORDER BY created_at ASC',
      [],
      'all',
    )) as any[]
    return (rows ?? []).map((r: any) => ({
      accountId: String(r.account_id),
      priority: Number(r.priority ?? 0),
      concurrency: Number(r.concurrency ?? DEFAULT_PROXY_POOL_CONCURRENCY),
    }))
  }

  /** 加入池（幂等）；priority/concurrency 缺省。已存在则不动既有字段/created_at。 */
  async add(
    accountId: string,
    priority = 0,
    concurrency = DEFAULT_PROXY_POOL_CONCURRENCY,
    nowMs: number = Date.now(),
  ): Promise<void> {
    const conn = this.getEm().getConnection()
    await conn.execute(
      'INSERT OR IGNORE INTO proxy_pool_members (account_id, priority, concurrency, created_at) VALUES (?, ?, ?, ?)',
      [accountId, priority, concurrency, nowMs],
    )
  }

  /** 更新成员优先级（不存在则无副作用）。 */
  async setPriority(accountId: string, priority: number): Promise<void> {
    const conn = this.getEm().getConnection()
    await conn.execute('UPDATE proxy_pool_members SET priority = ? WHERE account_id = ?', [
      priority,
      accountId,
    ])
  }

  /** 更新成员并发上限（不存在则无副作用）。 */
  async setConcurrency(accountId: string, concurrency: number): Promise<void> {
    const conn = this.getEm().getConnection()
    await conn.execute('UPDATE proxy_pool_members SET concurrency = ? WHERE account_id = ?', [
      concurrency,
      accountId,
    ])
  }

  async remove(accountId: string): Promise<void> {
    const conn = this.getEm().getConnection()
    await conn.execute('DELETE FROM proxy_pool_members WHERE account_id = ?', [accountId])
  }
}
