import type { ValidationService } from './validation-service'
import type {
  AccountPlatformLookup,
  HealthSnapshot,
  ProviderCapabilityRegistry,
  QuotaFetchResult,
} from './capability-ports'

/**
 * AccountHealthService — combine validation + quota into one HealthSnapshot.
 *
 * Run validation; if Valid, also fetch quota. Validation errors are normalized
 * to UnknownError rather than propagated, so a missing capability never crashes
 * the health call.
 */
export class AccountHealthService {
  constructor(
    private readonly validation: ValidationService,
    private readonly registry: ProviderCapabilityRegistry,
    private readonly platformLookup: AccountPlatformLookup,
  ) {}

  async snapshot(accountId: string): Promise<HealthSnapshot> {
    const checkedAt = new Date().toISOString()

    // 1. validation — normalize failures to unknown_error.
    let validation: HealthSnapshot['validation']
    try {
      validation = await this.validation.validate(accountId)
    } catch (e) {
      validation = {
        state: 'unknown_error',
        checked_at: new Date().toISOString(),
        details: e instanceof Error ? e.message : String(e),
      }
    }

    // 2. quota — only fetch when validation is Valid.
    let quota: QuotaFetchResult | undefined
    if (validation.state === 'valid') {
      quota = await this.fetchQuota(accountId).catch(() => undefined)
    }

    return {
      account_id: accountId,
      validation,
      quota,
      checked_at: checkedAt,
    }
  }

  private async fetchQuota(accountId: string): Promise<QuotaFetchResult> {
    const platform = await this.platformLookup.platformOf(accountId)
    if (platform === undefined) {
      throw new Error('no envelope')
    }
    const cap = this.registry.quota(platform)
    if (cap === undefined) {
      throw new Error(`unsupported provider: ${platform}`)
    }
    return cap.fetchQuota(accountId)
  }
}
