import { createLimit } from '../../../platform/async/limit'
import { CredentialError } from '../domain/credential-error'
import {
  unsupportedNow,
  type CredentialValidationResult,
} from '../domain/capability-types'
import type { CredentialRepository } from '../domain/credential-repository'
import type { ProviderRegistry } from '../domain/provider-registry'
import { platformFromAgentIdOrCursor } from '../../account/domain/platform-id'

// ValidationService — credential liveness checks for the validate-credential /
// validate-batch paths.
//
// validate(accountId): load the stored envelope, look up the provider from its
// AAD, dispatch to the provider's CredentialValidationCapability. A provider
// without a validation capability returns state="unsupported" (graceful, via
// unsupported_now()). A missing envelope is an error (the account has no
// credential to validate).
//
// validateBatch runs the per-account validations with bounded concurrency
// (default 4, via createLimit), isolating per-account errors into the result array
// (each item is either {account_id, result} or {account_id, error}).

export interface BatchValidationItem {
  accountId: string
  result?: CredentialValidationResult
  error?: string
}

export class ValidationService {
  constructor(
    private readonly repo: CredentialRepository,
    private readonly registry: ProviderRegistry,
  ) {}

  async validate(accountId: string): Promise<CredentialValidationResult> {
    const envelope = await this.repo.loadEnvelope(accountId)
    if (!envelope) {
      throw CredentialError.internal(`no credential envelope for account ${accountId}`)
    }
    const provider = platformFromAgentIdOrCursor(envelope.aad.provider)
    const cap = this.registry.validation(provider)
    if (!cap) {
      return unsupportedNow()
    }
    return cap.validate(envelope)
  }

  async validateBatch(
    accountIds: string[],
    concurrency = 4,
  ): Promise<BatchValidationItem[]> {
    const limit = createLimit(Math.max(1, concurrency))
    return Promise.all(
      accountIds.map((accountId) =>
        limit(async (): Promise<BatchValidationItem> => {
          try {
            const result = await this.validate(accountId)
            return { accountId, result }
          } catch (e) {
            return { accountId, error: e instanceof Error ? e.message : String(e) }
          }
        }),
      ),
    )
  }
}
