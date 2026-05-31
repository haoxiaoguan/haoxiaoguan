import type { Account } from '../domain/account'
import { AccountError } from '../domain/account-error'
import { platformFromAgentIdOrCursor } from '../domain/platform-id'
import type { CredentialStorePort, CredentialInjectorRegistry } from '../domain/ports'

// Result of a switch operation. 对应 SwitchResult.
export interface SwitchResult {
  success: boolean
  platformLaunched: boolean
}

/**
 * SwitchService — core switch business logic (source domain::switch_service).
 *
 * Steps: retrieve encrypted credential → decrypt → validate not expired → get
 * platform injector → inject into platform config file. Atomic: any failure
 * preserves the original state (we only inject; the application service handles
 * activate/deactivate persistence).
 */
export class SwitchService {
  constructor(
    private readonly credentialStore: CredentialStorePort,
    private readonly injectors: CredentialInjectorRegistry,
  ) {}

  async switchAccount(account: Account): Promise<SwitchResult> {
    // 1. Retrieve + decrypt credential.
    const credential = await this.credentialStore.retrieve(account.id)
    if (credential === null) {
      throw AccountError.notFound('Credential', account.id)
    }

    // 2. Validate not expired.
    if (credential.isExpired()) {
      throw AccountError.credentialExpired(account.id)
    }

    // 3. Resolve injector for the account's platform.
    const platform = platformFromAgentIdOrCursor(account.agentId)
    const injector = this.injectors.injector(platform)
    if (injector === undefined) {
      throw AccountError.notFound('PlatformAdapter', platform)
    }

    // 4. Inject the credential into the platform config file.
    await injector.inject(platform, credential)

    return { success: true, platformLaunched: false }
  }
}
