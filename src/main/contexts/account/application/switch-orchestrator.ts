import type { LaunchOptions, CredentialInjectorRegistry } from '../domain/ports'
import { AccountError } from '../domain/account-error'
import { platformFromAgentIdOrCursor } from '../domain/platform-id'
import type { AccountRepository } from '../domain/account-repository'
import type { CredentialStorePort } from '../domain/ports'

/**
 * SwitchOrchestrator — capability-path switch (source application::
 * switch_orchestrator, used by switch_account_v2). Resolves the injector by the
 * account's platform and injects the decrypted credential, honoring
 * launch_on_switch / executable_override via LaunchOptions.
 *
 * Unlike SwitchService it does NOT mutate account active-state; it is the
 * Phase-6 capability path that the frontend can use in parallel.
 */
export class SwitchOrchestrator {
  constructor(
    private readonly accountRepo: AccountRepository,
    private readonly credentialStore: CredentialStorePort,
    private readonly injectors: CredentialInjectorRegistry,
  ) {}

  async switch(accountId: string, _options: LaunchOptions): Promise<void> {
    const account = await this.accountRepo.findById(accountId)
    if (account === null) {
      throw AccountError.notFound('Account', accountId)
    }
    const credential = await this.credentialStore.retrieve(accountId)
    if (credential === null) {
      throw AccountError.invalidCredentialFormat('no envelope to inject')
    }
    const platform = platformFromAgentIdOrCursor(account.agentId)
    const injector = this.injectors.injector(platform)
    if (injector === undefined) {
      throw AccountError.notFound('PlatformAdapter', platform)
    }
    // launch_on_switch / executable_override are honored by capability impls
    // (agents layer) once IDE-launch support lands; injection is the core step.
    await injector.inject(platform, credential)
  }
}
