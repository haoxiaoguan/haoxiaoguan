import { createLimit } from '../../../platform/async/limit'
import { AccountError } from '../domain/account-error'
import type {
  AccountPlatformLookup,
  CredentialValidationResult,
  ProviderCapabilityRegistry,
  ValidationState,
} from './capability-ports'

export interface BatchValidationItem {
  accountId: string
  result: CredentialValidationResult | null
  error?: string
}

/**
 * ValidationService — credential liveness validation orchestration.
 *
 * Resolves the per-platform validation capability via the provider registry,
 * feeds the account through it, and returns a CredentialValidationResult.
 * Batch validation bounds concurrency (default 4) with a semaphore (createLimit).
 */
export class ValidationService {
  constructor(
    private readonly registry: ProviderCapabilityRegistry,
    private readonly platformLookup: AccountPlatformLookup,
  ) {}

  async validate(accountId: string): Promise<CredentialValidationResult> {
    const platform = await this.platformLookup.platformOf(accountId)
    if (platform === undefined) {
      throw AccountError.invalidCredentialFormat('no envelope stored')
    }
    const cap = this.registry.validation(platform)
    if (cap === undefined) {
      throw AccountError.invalidCredentialFormat(`unsupported provider: ${platform}`)
    }
    return cap.validate(accountId)
  }

  /** Bounded-concurrency batch validation; never rejects (per-item errors). */
  async validateBatch(accountIds: string[], concurrency: number): Promise<BatchValidationItem[]> {
    const limit = createLimit(Math.max(1, concurrency))
    return Promise.all(
      accountIds.map((accountId) =>
        limit(async (): Promise<BatchValidationItem> => {
          try {
            const result = await this.validate(accountId)
            return { accountId, result }
          } catch (e) {
            return {
              accountId,
              result: null,
              error: e instanceof Error ? e.message : String(e),
            }
          }
        }),
      ),
    )
  }

  /** Normalize an HTTP status to a ValidationState. */
  static mapHttpToState(status: number): ValidationState {
    if (status >= 200 && status <= 299) return 'valid'
    if (status === 401) return 'expired'
    if (status === 403) return 'revoked'
    if (status === 429) return 'rate_limited'
    return 'unknown_error'
  }
}
