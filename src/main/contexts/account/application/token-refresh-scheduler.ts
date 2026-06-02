import type { ValidationService } from './validation-service'
import type { AccountRepository } from '../domain/account-repository'
import { ALL_PLATFORM_IDS } from '../domain/platform-id'

const DEFAULT_TICK_MS = 60_000
const DEFAULT_CONCURRENCY = 4

/**
 * TokenRefreshScheduler — periodic health-scan scheduler. Ticks every 60s:
 * enumerate all accounts across all platforms and run
 * ValidationService.validateBatch with concurrency 4.
 *
 * Currently a health-scan (no actual token refresh — deferred to capability
 * impls). Uses setInterval + a guard flag for graceful shutdown.
 */
export class TokenRefreshScheduler {
  private timer: ReturnType<typeof setInterval> | null = null
  private ticking = false

  constructor(
    private readonly validation: ValidationService,
    private readonly accountRepo: AccountRepository,
    private readonly tickMs: number = DEFAULT_TICK_MS,
  ) {}

  /** Start the scheduler. No-op if already running. */
  start(): void {
    if (this.timer !== null) return
    this.timer = setInterval(() => {
      void this.tickOnce()
    }, this.tickMs)
    // Do not keep the event loop alive solely for this timer.
    if (typeof this.timer.unref === 'function') this.timer.unref()
  }

  /** Stop the scheduler. */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** One scan: gather all account ids, batch-validate. Skips if mid-tick. */
  async tickOnce(): Promise<void> {
    if (this.ticking) return
    this.ticking = true
    try {
      const allIds: string[] = []
      for (const platform of ALL_PLATFORM_IDS) {
        try {
          const list = await this.accountRepo.findByPlatform(platform)
          for (const account of list) allIds.push(account.id)
        } catch {
          // Skip a platform whose query fails; scan is best-effort.
        }
      }
      if (allIds.length === 0) return
      await this.validation.validateBatch(allIds, DEFAULT_CONCURRENCY)
    } finally {
      this.ticking = false
    }
  }
}
