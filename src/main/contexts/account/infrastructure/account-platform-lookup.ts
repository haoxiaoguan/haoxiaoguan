import type { AccountRepository } from '../domain/account-repository'
import {
  type PlatformId,
  platformFromAgentIdOrCursor,
} from '../domain/platform-id'
import type { AccountPlatformLookup } from '../application/capability-ports'

/**
 * Resolves an account's platform for the validation/health services, which
 * need to pick the right per-platform capability. Backed by the account repo.
 * Returns undefined when the account does not exist (the service maps that to
 * an InvalidCredential error, "no envelope stored").
 */
export class RepositoryAccountPlatformLookup implements AccountPlatformLookup {
  constructor(private readonly accountRepo: AccountRepository) {}

  async platformOf(accountId: string): Promise<PlatformId | undefined> {
    const account = await this.accountRepo.findById(accountId)
    if (account === null) return undefined
    return platformFromAgentIdOrCursor(account.agentId)
  }
}
