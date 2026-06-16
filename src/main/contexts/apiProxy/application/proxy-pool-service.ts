// 反代账号池成员服务：内存 Map 缓存（供选号热路径 O(1) 判定 + 每账号优先级/并发）+ 写穿仓储。
// 「账号必须在池内才能被反代」——FailoverAdapter 注入 has() 作候选门控；空池 → 无候选 → 503。
import {
  DEFAULT_PROXY_POOL_CONCURRENCY,
  type ProxyPoolRepository,
} from '../infrastructure/account-pool/proxy-pool.repository'

/** 内存中的成员配置：优先级 + 并发上限 + 429 限流冷却覆盖。 */
interface MemberConfig {
  priority: number
  concurrency: number
  /** 429 限流冷却（ms）。0=用全局；-1=不冷却；>0=自定义。 */
  rateLimitCooldownMs: number
}

export class ProxyPoolService {
  // accountId → {priority, concurrency}。在池 ⇔ 在 Map 中。
  private readonly members = new Map<string, MemberConfig>()
  private loaded = false

  constructor(private readonly repo: ProxyPoolRepository) {}

  /** 启动时载入持久化成员（含优先级/并发）到内存（幂等）。 */
  async load(): Promise<void> {
    const rows = await this.repo.list()
    this.members.clear()
    for (const r of rows) {
      this.members.set(r.accountId, {
        priority: r.priority,
        concurrency: r.concurrency,
        rateLimitCooldownMs: r.rateLimitCooldownMs,
      })
    }
    this.loaded = true
  }

  /** 账号是否在池内（选号热路径，同步 O(1)）。 */
  has(accountId: string): boolean {
    return this.members.has(accountId)
  }

  /** 账号的选号优先级（不在池内返回 0）。选号热路径，同步 O(1)。 */
  getPriority(accountId: string): number {
    return this.members.get(accountId)?.priority ?? 0
  }

  /** 账号的并发上限（不在池内返回默认值）。选号热路径，同步 O(1)。 */
  getConcurrency(accountId: string): number {
    return this.members.get(accountId)?.concurrency ?? DEFAULT_PROXY_POOL_CONCURRENCY
  }

  /** 账号的 429 限流冷却覆盖（ms）。不在池内返回 0（=随全局）。0=全局/-1=不冷却/>0=自定义。 */
  getRateLimitCooldownMs(accountId: string): number {
    return this.members.get(accountId)?.rateLimitCooldownMs ?? 0
  }

  /** 当前池成员账号 id 列表。 */
  listIds(): string[] {
    return [...this.members.keys()]
  }

  /** 池成员数量。 */
  size(): number {
    return this.members.size
  }

  /** 加入池（幂等，写穿落库）；priority/concurrency 缺省，已在池则保留既有配置。 */
  async add(
    accountId: string,
    priority = 0,
    concurrency = DEFAULT_PROXY_POOL_CONCURRENCY,
    rateLimitCooldownMs = 0,
  ): Promise<void> {
    await this.repo.add(accountId, priority, concurrency, rateLimitCooldownMs)
    if (!this.members.has(accountId)) {
      this.members.set(accountId, { priority, concurrency, rateLimitCooldownMs })
    }
  }

  /** 移出池（幂等，写穿落库）。 */
  async remove(accountId: string): Promise<void> {
    await this.repo.remove(accountId)
    this.members.delete(accountId)
  }

  /** 设置入池状态。 */
  async setPooled(accountId: string, pooled: boolean): Promise<void> {
    if (pooled) await this.add(accountId)
    else await this.remove(accountId)
  }

  /** 设置成员优先级（仅对在池账号生效；写穿落库）。 */
  async setPriority(accountId: string, priority: number): Promise<void> {
    const m = this.members.get(accountId)
    if (m === undefined) return
    await this.repo.setPriority(accountId, priority)
    m.priority = priority
  }

  /** 设置成员并发上限（仅对在池账号生效；写穿落库）。 */
  async setConcurrency(accountId: string, concurrency: number): Promise<void> {
    const m = this.members.get(accountId)
    if (m === undefined) return
    await this.repo.setConcurrency(accountId, concurrency)
    m.concurrency = concurrency
  }

  /**
   * 批量设置成员 429 限流冷却覆盖（ms：0=全局/-1=不冷却/>0=自定义；仅对在池账号生效；写穿落库）。
   * 返回实际生效的账号 id 列表（过滤掉不在池的）。
   */
  async setRateLimitCooldown(accountIds: string[], rateLimitCooldownMs: number): Promise<string[]> {
    const pooled = accountIds.filter((id) => this.members.has(id))
    if (pooled.length === 0) return []
    await this.repo.setRateLimitCooldown(pooled, rateLimitCooldownMs)
    for (const id of pooled) {
      const m = this.members.get(id)
      if (m !== undefined) m.rateLimitCooldownMs = rateLimitCooldownMs
    }
    return pooled
  }

  /** 是否已载入（诊断用）。 */
  isLoaded(): boolean {
    return this.loaded
  }
}
