import type { AccountRepository } from '../../account/domain/account-repository'
import { platformToFrontendId, type PlatformId } from '../../account/domain/platform-id'
import { QUOTA_FETCH_PLATFORMS } from './quota-service'

const DEFAULT_TICK_MS = 60_000

/** The slice of QuotaService this scheduler needs (single-account refresh). */
export interface QuotaRefresher {
  refreshQuota(accountId: string): Promise<unknown>
}

/** The settings reads this scheduler needs, keyed by FRONTEND (kebab) platform id. */
export interface SchedulerSettings {
  /** Active-account refresh intervals (minutes) by frontend platform id. */
  getActiveRefreshIntervals(): Record<string, number>
  /** Whole-platform batch refresh intervals (minutes; 0 = disabled) by frontend id. */
  getPlatformRefreshIntervals(): Record<string, number>
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
 *    `platform_refresh_interval_<p>` minutes (0 = disabled, the default — we
 *    never sweep a whole platform unless the user opts in, to avoid rate limits).
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
    this.timer = setInterval(() => {
      void this.tickOnce()
    }, this.tickMs)
    if (typeof this.timer.unref === 'function') this.timer.unref()
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
      const activeIntervals = this.settings.getActiveRefreshIntervals()
      const batchIntervals = this.settings.getPlatformRefreshIntervals()
      const refreshed: string[] = []

      for (const platform of this.platforms) {
        const key = platformToFrontendId(platform)
        const timers = this.timersFor(platform)
        const nowMs = this.now()

        const batchMin = batchIntervals[key] ?? 0
        const dueBatch = batchMin > 0 && nowMs - timers.lastBatchAt >= batchMin * 60_000

        const activeMin = activeIntervals[key] ?? 5
        const dueActive = nowMs - timers.lastActiveAt >= activeMin * 60_000

        if (dueBatch) {
          timers.lastBatchAt = nowMs
          // Batch covers the active account too, so skip a redundant active pass.
          timers.lastActiveAt = nowMs
          const ids = await this.refreshAllOfPlatform(platform)
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

  private async refreshAllOfPlatform(platform: PlatformId): Promise<string[]> {
    let accounts
    try {
      accounts = await this.accountRepo.findByPlatform(platform)
    } catch {
      return []
    }
    const done: string[] = []
    for (const account of accounts) {
      try {
        await this.quota.refreshQuota(account.id)
        done.push(account.id)
      } catch {
        // Isolated: a single account's failure must not abort the sweep.
      }
    }
    return done
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
    } catch {
      return null
    }
  }
}
