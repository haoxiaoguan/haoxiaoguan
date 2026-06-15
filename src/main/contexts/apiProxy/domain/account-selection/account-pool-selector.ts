export interface PoolCandidate {
  id: string
  lastUsedAt?: number
  /** 选号权重优先级（越大占比越高；缺省 0）。来自反代池成员配置。 */
  priority?: number
  /** 每账号并发上限（缺省回退到 SelectorOpts.perAccountConcurrency 全局值）。来自反代池成员配置。 */
  concurrency?: number
}
export interface SelectionCtx {
  hint?: string
  triedIds: Set<string>
  model: string
}
export interface AccountLease {
  id: string
  release(): void
}
export interface TokenBucketOpts {
  /** 每账号令牌桶容量（突发上限），单位：请求数。 */
  capacityPerAccount: number
  /** 每分钟向每个账号补充的令牌数。 */
  refillPerMinute: number
}

export interface SelectorOpts {
  strategy: 'sticky-lru' | 'round-robin'
  perAccountConcurrency: number
  affinityTtlMs: number
  clock?: () => number
  /** 可注入随机函数（测试用），默认 Math.random。用于优先级加权选号。 */
  random?: () => number
  /**
   * 可选 per-account 令牌桶。不配置 = 不限流，向后兼容。
   * 后续可接 settings 标量化配置。
   */
  tokenBucket?: TokenBucketOpts
}
/** 候选健康判定（注入 AccountHealthTracker.isAvailable）。 */
export interface HealthGate {
  isAvailable(id: string): boolean
}

interface AffinityEntry {
  accountId: string
  lastAt: number
}

interface BucketState {
  tokens: number
  lastRefillMs: number
}

/**
 * 账号选择：策略（sticky-lru / round-robin）+ 会话粘性 + 每账号并发闸。
 * 候选过滤：health 可用 + 并发未满 + 不在 triedIds。选中返回 lease（占并发，release 归还）。
 * 全不可用 → null。纯逻辑（注入 clock），无 IO。
 * 可选 per-account 令牌桶（tokenBucket 未配置时不限流，向后兼容）。
 */
export class AccountPoolSelector {
  private readonly inflight = new Map<string, number>()
  private readonly affinity = new Map<string, AffinityEntry>()
  private readonly buckets = new Map<string, BucketState>()
  private readonly clock: () => number
  private readonly random: () => number
  private cursor = 0

  constructor(private readonly opts: SelectorOpts, private readonly health: HealthGate) {
    this.clock = opts.clock ?? Date.now
    this.random = opts.random ?? Math.random
  }

  /**
   * 运行时热更选号配置（轮询策略 / 每账号并发 / 亲密度 TTL）。
   * 反代设置弹窗保存后调用，无需重启即可生效（priority 走候选侧，天然即时）。
   */
  updateOpts(
    patch: Partial<Pick<SelectorOpts, 'strategy' | 'perAccountConcurrency' | 'affinityTtlMs'>>,
  ): void {
    if (patch.strategy !== undefined) this.opts.strategy = patch.strategy
    if (patch.perAccountConcurrency !== undefined && patch.perAccountConcurrency >= 1) {
      this.opts.perAccountConcurrency = patch.perAccountConcurrency
    }
    if (patch.affinityTtlMs !== undefined && patch.affinityTtlMs >= 0) {
      this.opts.affinityTtlMs = patch.affinityTtlMs
    }
  }

  /** 按时间差向桶补充令牌，新账号初始满桶。返回当前可用令牌数。 */
  private refillBucket(id: string): number {
    const tb = this.opts.tokenBucket
    if (tb === undefined) return Infinity
    const now = this.clock()
    const state = this.buckets.get(id)
    if (state === undefined) {
      // 新账号初始满桶
      this.buckets.set(id, { tokens: tb.capacityPerAccount, lastRefillMs: now })
      return tb.capacityPerAccount
    }
    const elapsedMinutes = (now - state.lastRefillMs) / 60_000
    const refilled = Math.min(tb.capacityPerAccount, state.tokens + elapsedMinutes * tb.refillPerMinute)
    state.tokens = refilled
    state.lastRefillMs = now
    return refilled
  }

  /** 消费 1 个令牌（lease 时调用）。 */
  private consumeToken(id: string): void {
    if (this.opts.tokenBucket === undefined) return
    const state = this.buckets.get(id)
    if (state !== undefined) {
      state.tokens = Math.max(0, state.tokens - 1)
    }
  }

  acquire(candidates: PoolCandidate[], ctx: SelectionCtx): AccountLease | null {
    const usable = candidates.filter(
      (c) =>
        !ctx.triedIds.has(c.id) &&
        this.health.isAvailable(c.id) &&
        (this.inflight.get(c.id) ?? 0) < (c.concurrency ?? this.opts.perAccountConcurrency) &&
        this.refillBucket(c.id) >= 1,
    )
    if (usable.length === 0) return null

    let chosen: PoolCandidate | undefined
    if (this.opts.strategy === 'sticky-lru' && ctx.hint !== undefined) {
      chosen = this.stickyHit(ctx.hint, usable)
    }
    if (chosen === undefined) {
      chosen = this.freshPick(usable)
    }
    return this.lease(chosen)
  }

  /**
   * 新会话/无粘性命中时的挑选：
   *  - 候选优先级不全相等 → 按权重（weight = max(0,priority)+1）随机加权选号（高优先级占比更高，
   *    低优先级仍持续分到流量）；
   *  - 全相等（含默认全 0）→ 退回原策略（round-robin 游标 / sticky-lru 的 leastLoadedLru），零回归。
   */
  private freshPick(usable: PoolCandidate[]): PoolCandidate {
    if (this.hasMixedPriority(usable)) return this.weightedPick(usable)
    return this.opts.strategy === 'round-robin'
      ? this.roundRobin(usable)
      : this.leastLoadedLru(usable)
  }

  /** 选号权重：优先级负值截断为 0，再 +1 保证每个候选至少有最小份额。 */
  private weightOf(c: PoolCandidate): number {
    return Math.max(0, c.priority ?? 0) + 1
  }

  /** 候选权重是否存在差异（用于判断是否启用加权）。 */
  private hasMixedPriority(usable: PoolCandidate[]): boolean {
    if (usable.length < 2) return false
    const first = this.weightOf(usable[0])
    return usable.some((c) => this.weightOf(c) !== first)
  }

  /** 按权重做一次随机加权选取（权重和兜底，最后一项兜底返回防浮点误差越界）。 */
  private weightedPick(usable: PoolCandidate[]): PoolCandidate {
    const total = usable.reduce((s, c) => s + this.weightOf(c), 0)
    let r = this.random() * total
    for (const c of usable) {
      r -= this.weightOf(c)
      if (r < 0) return c
    }
    return usable[usable.length - 1]
  }

  remember(hint: string, id: string): void {
    this.affinity.set(hint, { accountId: id, lastAt: this.clock() })
  }

  /** 当前所有账号在途请求数之和（G10 inflight gauge 数据源）。 */
  totalInflight(): number {
    let sum = 0
    for (const n of this.inflight.values()) sum += n
    return sum
  }

  sweep(): void {
    const now = this.clock()
    for (const [h, e] of this.affinity) {
      if (now - e.lastAt > this.opts.affinityTtlMs) this.affinity.delete(h)
    }
  }

  private stickyHit(hint: string, usable: PoolCandidate[]): PoolCandidate | undefined {
    const entry = this.affinity.get(hint)
    if (entry === undefined) return undefined
    if (this.clock() - entry.lastAt > this.opts.affinityTtlMs) {
      this.affinity.delete(hint)
      return undefined
    }
    return usable.find((c) => c.id === entry.accountId)
  }

  private leastLoadedLru(usable: PoolCandidate[]): PoolCandidate {
    return [...usable].sort((a, b) => {
      const la = this.inflight.get(a.id) ?? 0
      const lb = this.inflight.get(b.id) ?? 0
      if (la !== lb) return la - lb
      return (a.lastUsedAt ?? 0) - (b.lastUsedAt ?? 0)
    })[0]
  }

  private roundRobin(usable: PoolCandidate[]): PoolCandidate {
    const idx = this.cursor % usable.length
    this.cursor = (this.cursor + 1) % Math.max(usable.length, 1)
    return usable[idx]
  }

  private lease(c: PoolCandidate): AccountLease {
    this.inflight.set(c.id, (this.inflight.get(c.id) ?? 0) + 1)
    this.consumeToken(c.id)
    let released = false
    return {
      id: c.id,
      release: () => {
        if (released) return
        released = true
        this.inflight.set(c.id, Math.max((this.inflight.get(c.id) ?? 1) - 1, 0))
      },
    }
  }
}
