export interface PoolCandidate {
  id: string
  lastUsedAt?: number
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
export interface SelectorOpts {
  strategy: 'sticky-lru' | 'round-robin'
  perAccountConcurrency: number
  affinityTtlMs: number
  clock?: () => number
}
/** 候选健康判定（注入 AccountHealthTracker.isAvailable）。 */
export interface HealthGate {
  isAvailable(id: string): boolean
}

interface AffinityEntry {
  accountId: string
  lastAt: number
}

/**
 * 账号选择：策略（sticky-lru / round-robin）+ 会话粘性 + 每账号并发闸。
 * 候选过滤：health 可用 + 并发未满 + 不在 triedIds。选中返回 lease（占并发，release 归还）。
 * 全不可用 → null。纯逻辑（注入 clock），无 IO。
 */
export class AccountPoolSelector {
  private readonly inflight = new Map<string, number>()
  private readonly affinity = new Map<string, AffinityEntry>()
  private readonly clock: () => number
  private cursor = 0

  constructor(private readonly opts: SelectorOpts, private readonly health: HealthGate) {
    this.clock = opts.clock ?? Date.now
  }

  acquire(candidates: PoolCandidate[], ctx: SelectionCtx): AccountLease | null {
    const usable = candidates.filter(
      (c) =>
        !ctx.triedIds.has(c.id) &&
        this.health.isAvailable(c.id) &&
        (this.inflight.get(c.id) ?? 0) < this.opts.perAccountConcurrency,
    )
    if (usable.length === 0) return null

    let chosen: PoolCandidate | undefined
    if (this.opts.strategy === 'sticky-lru' && ctx.hint !== undefined) {
      chosen = this.stickyHit(ctx.hint, usable)
    }
    if (chosen === undefined) {
      chosen = this.opts.strategy === 'round-robin' ? this.roundRobin(usable) : this.leastLoadedLru(usable)
    }
    return this.lease(chosen, ctx.hint)
  }

  remember(hint: string, id: string): void {
    this.affinity.set(hint, { accountId: id, lastAt: this.clock() })
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

  private lease(c: PoolCandidate, hint: string | undefined): AccountLease {
    this.inflight.set(c.id, (this.inflight.get(c.id) ?? 0) + 1)
    if (hint !== undefined) this.remember(hint, c.id)
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
