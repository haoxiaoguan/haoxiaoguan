import type { AccountRepository } from '../../account/domain/account-repository'
import { platformToFrontendId, type PlatformId } from '../../account/domain/platform-id'
import { createLimit } from '../../../platform/async/limit'
import { QUOTA_FETCH_PLATFORMS } from './quota-service'

const DEFAULT_TICK_MS = 60_000

/** Default whole-platform batch interval (minutes) when a platform is unconfigured.
 *  Batch refresh is ON by default for every platform; the user can disable a
 *  platform by explicitly setting its interval to 0. */
const DEFAULT_BATCH_MIN = 10

/** Default parallelism for a batch sweep when settings omit it. */
const DEFAULT_CONCURRENCY = 3

/** The slice of QuotaService this scheduler needs (single-account refresh). */
export interface QuotaRefresher {
  refreshQuota(accountId: string): Promise<unknown>
  /** 账号 quota_state 的最近抓取时间（无记录返回 null）。供重启后播种计时器，
   *  让重启不再使所有平台重新等满一个完整间隔。可选：未实现时保持构造播种。 */
  getQuotaFetchedAt?(accountId: string): Promise<Date | null>
}

/** The settings reads this scheduler needs, keyed by FRONTEND (kebab) platform id. */
export interface SchedulerSettings {
  /** Active-account refresh intervals (minutes) by frontend platform id. */
  getActiveRefreshIntervals(): Record<string, number>
  /** Whole-platform batch refresh intervals (minutes; 0 = disabled) by frontend id. */
  getPlatformRefreshIntervals(): Record<string, number>
  /** Max accounts refreshed in parallel during a batch sweep (global, 1–10). */
  getQuotaRefreshConcurrency(): number
}

interface PlatformTimers {
  lastBatchAt: number
  lastActiveAt: number
}

/**
 * PlatformQuotaScheduler — periodic per-platform quota refresh.
 *
 * Two independent cadences per platform, both configured in settings:
 *  - BATCH: refresh every account of the platform every
 *    `platform_refresh_interval_<p>` minutes. Defaults to 10 (ON) for every
 *    platform; the user disables a platform by setting its interval to 0. The
 *    sweep parallelism is bounded by the global `quota_refresh_concurrency`.
 *  - ACTIVE: refresh only the active account every `refresh_interval_<p>`
 *    minutes (default 5).
 *
 * Settings keys are the FRONTEND (kebab) platform id; the scheduler iterates the
 * main-side snake PlatformId and maps via platformToFrontendId.
 *
 * Mirrors TokenRefreshScheduler's lifecycle: a single 60s master tick with a
 * reentrancy guard and an unref'd timer. Per-account refresh failures are
 * isolated so one bad account never aborts the sweep.
 */
export class PlatformQuotaScheduler {
  private timer: ReturnType<typeof setInterval> | null = null
  private ticking = false
  private seeding: Promise<void> | null = null
  private readonly timers = new Map<PlatformId, PlatformTimers>()

  constructor(
    private readonly settings: SchedulerSettings,
    private readonly accountRepo: AccountRepository,
    private readonly quota: QuotaRefresher,
    private onRefreshed?: (accountIds: string[]) => void,
    private readonly now: () => number = () => Date.now(),
    private readonly tickMs: number = DEFAULT_TICK_MS,
    private readonly platforms: readonly PlatformId[] = QUOTA_FETCH_PLATFORMS,
  ) {
    // Seed every platform's clocks to construction time so neither a batch nor
    // an active refresh fires on the very first tick — each waits a full
    // interval. Avoids a startup thundering herd across all platforms at once.
    const seed = this.now()
    for (const p of this.platforms) {
      this.timers.set(p, { lastBatchAt: seed, lastActiveAt: seed })
    }
  }

  /**
   * Set (or replace) the post-refresh callback. main.ts uses this to push a
   * webContents.send once the BrowserWindow exists (after buildContainer).
   */
  setOnRefreshed(cb: (accountIds: string[]) => void): void {
    this.onRefreshed = cb
  }

  /** Start the scheduler. No-op if already running. */
  start(): void {
    if (this.timer !== null) return
    // 异步播种与定时器并行启动；tickOnce 会先等播种完成再决策。
    this.seeding = this.seedFromStore()
    this.timer = setInterval(() => {
      void this.tickOnce()
    }, this.tickMs)
    if (typeof this.timer.unref === 'function') this.timer.unref()
  }

  /**
   * 用持久化的 quota_state.fetched_at 回填各平台计时器，避免每次重启都让所有
   * 平台重新等满一个完整间隔（dev 模式重启频繁时账号会长时间不被刷新）。
   *
   * lastBatchAt 取「非活跃账号」的最近抓取时间——非活跃账号只会被批量 sweep
   * 刷新，它就是上次 sweep 的近似时刻；平台只有活跃账号时退化用活跃账号的。
   * 只影响重启后的第一轮：sweep 触发时 lastBatchAt 立即推进到当前时刻，
   * 所以长期刷新失败的账号不会导致每个 tick 都重扫。
   */
  async seedFromStore(): Promise<void> {
    const read = this.quota.getQuotaFetchedAt?.bind(this.quota)
    if (read === undefined) return
    for (const platform of this.platforms) {
      try {
        const accounts = await this.accountRepo.findByPlatform(platform)
        if (accounts.length === 0) continue
        const active = await this.accountRepo.findActiveByPlatform(platform)
        let lastBatch: number | null = null
        let lastActive: number | null = null
        for (const account of accounts) {
          const at = await read(account.id)
          if (at === null) continue
          const ms = at.getTime()
          if (account.id === active?.id) {
            lastActive = Math.max(lastActive ?? 0, ms)
          } else {
            lastBatch = Math.max(lastBatch ?? 0, ms)
          }
        }
        if (lastBatch === null) lastBatch = lastActive
        const timers = this.timersFor(platform)
        const nowMs = this.now()
        // 永不向未来播种（时钟回拨/脏数据防御）。
        if (lastBatch !== null) timers.lastBatchAt = Math.min(lastBatch, nowMs)
        if (lastActive !== null) timers.lastActiveAt = Math.min(lastActive, nowMs)
      } catch {
        // 读取失败：该平台保持构造时的保守播种（等满一个间隔），不阻断其他平台。
      }
    }
  }

  /** Stop the scheduler. */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /**
   * One pass: for each platform decide whether a batch and/or active refresh is
   * due, run the due refreshes, and notify via onRefreshed. Skips if mid-tick.
   */
  async tickOnce(): Promise<void> {
    if (this.ticking) return
    this.ticking = true
    try {
      // 首个 tick 前确保播种完成，避免与计时器回填竞争。
      if (this.seeding !== null) {
        await this.seeding.catch(() => {})
        this.seeding = null
      }
      const activeIntervals = this.settings.getActiveRefreshIntervals()
      const batchIntervals = this.settings.getPlatformRefreshIntervals()
      const concurrency = this.settings.getQuotaRefreshConcurrency()
      const refreshed: string[] = []

      for (const platform of this.platforms) {
        const key = platformToFrontendId(platform)
        const timers = this.timersFor(platform)
        const nowMs = this.now()

        const batchMin = batchIntervals[key] ?? DEFAULT_BATCH_MIN
        const dueBatch = batchMin > 0 && nowMs - timers.lastBatchAt >= batchMin * 60_000

        const activeMin = activeIntervals[key] ?? 5
        const dueActive = nowMs - timers.lastActiveAt >= activeMin * 60_000

        if (dueBatch) {
          timers.lastBatchAt = nowMs
          // Batch covers the active account too, so skip a redundant active pass.
          timers.lastActiveAt = nowMs
          const ids = await this.refreshAllOfPlatform(platform, concurrency)
          refreshed.push(...ids)
        } else if (dueActive) {
          timers.lastActiveAt = nowMs
          const id = await this.refreshActiveOfPlatform(platform)
          if (id !== null) refreshed.push(id)
        }
      }

      if (refreshed.length > 0 && this.onRefreshed !== undefined) {
        this.onRefreshed(refreshed)
      }
    } finally {
      this.ticking = false
    }
  }

  private timersFor(platform: PlatformId): PlatformTimers {
    let t = this.timers.get(platform)
    if (t === undefined) {
      const seed = this.now()
      t = { lastBatchAt: seed, lastActiveAt: seed }
      this.timers.set(platform, t)
    }
    return t
  }

  private async refreshAllOfPlatform(platform: PlatformId, concurrency: number): Promise<string[]> {
    let accounts
    try {
      accounts = await this.accountRepo.findByPlatform(platform)
    } catch {
      return []
    }
    // Bound parallelism by the global concurrency setting so a platform with
    // many accounts doesn't fire every live fetch at once. Failures are
    // isolated per account: one bad account never aborts the sweep.
    const limit = createLimit(concurrency >= 1 ? concurrency : DEFAULT_CONCURRENCY)
    const settled = await Promise.all(
      accounts.map((account) =>
        limit(async () => {
          try {
            await this.quota.refreshQuota(account.id)
            return { id: account.id }
          } catch (e) {
            return { id: account.id, error: e instanceof Error ? e.message : String(e) }
          }
        }),
      ),
    )
    // 失败不再静默：汇总告警，否则「持续刷新失败」与「调度器没在跑」无法区分。
    const failures = settled.filter((r) => r.error !== undefined)
    if (failures.length > 0) {
      const head = failures.slice(0, 3).map((f) => `${f.id}: ${f.error}`).join('; ')
      console.warn(
        `[quota-scheduler] ${platform} 批量刷新失败 ${failures.length}/${accounts.length} — ${head}${failures.length > 3 ? ' …' : ''}`,
      )
    }
    return settled.filter((r) => r.error === undefined).map((r) => r.id)
  }

  private async refreshActiveOfPlatform(platform: PlatformId): Promise<string | null> {
    let active
    try {
      active = await this.accountRepo.findActiveByPlatform(platform)
    } catch {
      return null
    }
    if (active === null) return null
    try {
      await this.quota.refreshQuota(active.id)
      return active.id
    } catch (e) {
      console.warn(
        `[quota-scheduler] ${platform} 活跃账号刷新失败 — ${active.id}: ${e instanceof Error ? e.message : String(e)}`,
      )
      return null
    }
  }
}
