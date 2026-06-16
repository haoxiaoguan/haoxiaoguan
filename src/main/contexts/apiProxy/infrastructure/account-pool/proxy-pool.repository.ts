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

/** 默认每账号 429 限流冷却（0 = 随全局配置）。 */
export const DEFAULT_PROXY_POOL_RATE_LIMIT_COOLDOWN_MS = 0

/** 池成员（含优先级 + 并发上限 + 429 限流冷却覆盖）。 */
export interface ProxyPoolMemberRow {
  accountId: string
  priority: number
  concurrency: number
  /** 429 限流冷却（ms）。0=用全局；-1=不冷却；>0=自定义。 */
  rateLimitCooldownMs: number
}

export class ProxyPoolRepository {
  private readonly getEm: () => EntityManager

  constructor(getEmFn?: () => EntityManager) {
    this.getEm = getEmFn ?? defaultGetEm
  }

  /** 列出全部成员（含优先级 + 并发上限 + 限流冷却覆盖）。 */
  async list(): Promise<ProxyPoolMemberRow[]> {
    const conn = this.getEm().getConnection()
    const rows = (await conn.execute(
      'SELECT account_id, priority, concurrency, rate_limit_cooldown_ms FROM proxy_pool_members ORDER BY created_at ASC',
      [],
      'all',
    )) as any[]
    return (rows ?? []).map((r: any) => ({
      accountId: String(r.account_id),
      priority: Number(r.priority ?? 0),
      concurrency: Number(r.concurrency ?? DEFAULT_PROXY_POOL_CONCURRENCY),
      rateLimitCooldownMs: Number(r.rate_limit_cooldown_ms ?? DEFAULT_PROXY_POOL_RATE_LIMIT_COOLDOWN_MS),
    }))
  }

  /** 加入池（幂等）；priority/concurrency/限流冷却缺省。已存在则不动既有字段/created_at。 */
  async add(
    accountId: string,
    priority = 0,
    concurrency = DEFAULT_PROXY_POOL_CONCURRENCY,
    rateLimitCooldownMs = DEFAULT_PROXY_POOL_RATE_LIMIT_COOLDOWN_MS,
    nowMs: number = Date.now(),
  ): Promise<void> {
    const conn = this.getEm().getConnection()
    await conn.execute(
      'INSERT OR IGNORE INTO proxy_pool_members (account_id, priority, concurrency, rate_limit_cooldown_ms, created_at) VALUES (?, ?, ?, ?, ?)',
      [accountId, priority, concurrency, rateLimitCooldownMs, nowMs],
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

  /** 批量更新成员 429 限流冷却（ms：0=全局/-1=不冷却/>0=自定义）。不在池的 id 无副作用。 */
  async setRateLimitCooldown(accountIds: string[], rateLimitCooldownMs: number): Promise<void> {
    if (accountIds.length === 0) return
    const conn = this.getEm().getConnection()
    const placeholders = accountIds.map(() => '?').join(', ')
    await conn.execute(
      `UPDATE proxy_pool_members SET rate_limit_cooldown_ms = ? WHERE account_id IN (${placeholders})`,
      [rateLimitCooldownMs, ...accountIds],
    )
  }

  async remove(accountId: string): Promise<void> {
    const conn = this.getEm().getConnection()
    await conn.execute('DELETE FROM proxy_pool_members WHERE account_id = ?', [accountId])
  }
}
