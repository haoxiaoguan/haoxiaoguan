export interface HealthTrackerOpts {
  baseCooldownMs: number
  maxBackoffMultiplier: number
  quotaResetMs: number
  probabilisticRetryChance: number
  clock?: () => number
  random?: () => number
}

interface HealthState {
  failureCount: number
  cooldownUntil: number
  quotaExhaustedAt: number  // -1 = 未耗尽
  suspended: boolean
}

export interface AccountRuntimeHealth {
  accountId: string
  runtimeState: 'available' | 'cooldown' | 'quota_exhausted' | 'suspended'
  failureCount: number
  cooldownUntilMs?: number
  quotaExhaustedAtMs?: number
}

function fresh(): HealthState {
  return { failureCount: 0, cooldownUntil: 0, quotaExhaustedAt: -1, suspended: false }
}

/**
 * 三级健康运行态（内存，重启重建）：
 * ① 瞬时熔断：markFailure 指数退避冷却 + 概率半开探测。
 * ② 配额耗尽：markRateLimited 后 quotaResetMs 自恢复。
 * ③ 风控挂起：markSuspended 永久不可用（持久化由调用方写库），仅 clearSuspension 恢复。
 */
export class AccountHealthTracker {
  private readonly states = new Map<string, HealthState>()
  private readonly clock: () => number
  private readonly random: () => number

  constructor(private readonly opts: HealthTrackerOpts) {
    this.clock = opts.clock ?? Date.now
    this.random = opts.random ?? Math.random
  }

  private getOrCreate(id: string): HealthState {
    let s = this.states.get(id)
    if (s === undefined) { s = fresh(); this.states.set(id, s) }
    return s
  }

  isAvailable(id: string): boolean {
    const s = this.states.get(id)
    if (s === undefined) return true
    if (s.suspended) return false
    const now = this.clock()
    if (s.quotaExhaustedAt >= 0 && now - s.quotaExhaustedAt < this.opts.quotaResetMs) return false
    if (now < s.cooldownUntil) {
      return this.random() < this.opts.probabilisticRetryChance // 半开探测
    }
    return true
  }

  recordSuccess(id: string): void {
    const s = this.getOrCreate(id)
    s.failureCount = 0
    s.cooldownUntil = 0
    s.quotaExhaustedAt = -1
    // 健康账号无需长期占 entry：状态已 fresh 且未 suspended 则删除。
    if (!s.suspended) this.states.delete(id)
  }

  /**
   * 惰性清理：删除已完全恢复（非 suspended、冷却期已过、配额已恢复、失败归零）的 entry。
   * 调用方可在低频定时任务中调用，防止长跑进程 states Map 无限增长。
   */
  sweep(): void {
    const now = this.clock()
    for (const [id, s] of this.states) {
      if (s.suspended) continue
      if (s.failureCount !== 0) continue
      if (now < s.cooldownUntil) continue
      const quotaCleared = s.quotaExhaustedAt < 0 || now - s.quotaExhaustedAt >= this.opts.quotaResetMs
      if (!quotaCleared) continue
      this.states.delete(id)
    }
  }

  markFailure(id: string): void {
    const s = this.getOrCreate(id)
    s.failureCount += 1
    const mult = Math.min(2 ** (s.failureCount - 1), this.opts.maxBackoffMultiplier)
    s.cooldownUntil = this.clock() + this.opts.baseCooldownMs * mult
  }

  markRateLimited(id: string): void {
    this.getOrCreate(id).quotaExhaustedAt = this.clock()
  }

  markSuspended(id: string): void {
    this.getOrCreate(id).suspended = true
  }

  clearSuspension(id: string): void {
    const s = this.getOrCreate(id)
    s.suspended = false
    s.failureCount = 0
    s.cooldownUntil = 0
    s.quotaExhaustedAt = -1
  }

  /** 派生运行态（优先级 suspended > quota_exhausted > cooldown > available）。 */
  snapshot(id: string): AccountRuntimeHealth {
    const s = this.states.get(id)
    if (s === undefined) return { accountId: id, runtimeState: 'available', failureCount: 0 }
    if (s.suspended) return { accountId: id, runtimeState: 'suspended', failureCount: s.failureCount }
    const now = this.clock()
    if (s.quotaExhaustedAt >= 0 && now - s.quotaExhaustedAt < this.opts.quotaResetMs) {
      return { accountId: id, runtimeState: 'quota_exhausted', failureCount: s.failureCount, quotaExhaustedAtMs: s.quotaExhaustedAt }
    }
    if (now < s.cooldownUntil) {
      return { accountId: id, runtimeState: 'cooldown', failureCount: s.failureCount, cooldownUntilMs: s.cooldownUntil }
    }
    return { accountId: id, runtimeState: 'available', failureCount: s.failureCount }
  }

  snapshotAll(ids: string[]): AccountRuntimeHealth[] {
    return ids.map((id) => this.snapshot(id))
  }
}
