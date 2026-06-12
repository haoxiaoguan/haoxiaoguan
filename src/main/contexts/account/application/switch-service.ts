import type { Account } from '../domain/account'
import { AccountError } from '../domain/account-error'
import { platformFromAgentIdOrCursor } from '../domain/platform-id'
import type {
  CredentialStorePort,
  CredentialInjectorRegistry,
  CredentialRefresherRegistry,
  SwitchLifecycleRegistry,
} from '../domain/ports'

// Result of a switch operation.
export interface SwitchResult {
  success: boolean
  platformLaunched: boolean
}

/**
 * SwitchService — core switch business logic.
 *
 * Steps: retrieve encrypted credential → decrypt → refresh if the platform has
 * a refresher and the token needs it (persisted back to the store) → validate
 * not expired → resolve platform injector → bracket the injection with the
 * platform's switch lifecycle（如 Codex 的「停 App → 写 → 启 App」）→ inject.
 * Atomic: any failure preserves the original state (we only inject; the
 * application service handles activate/deactivate persistence).
 */
export class SwitchService {
  constructor(
    private readonly credentialStore: CredentialStorePort,
    private readonly injectors: CredentialInjectorRegistry,
    private readonly refreshers?: CredentialRefresherRegistry,
    private readonly lifecycles?: SwitchLifecycleRegistry,
  ) {}

  async switchAccount(account: Account): Promise<SwitchResult> {
    // 1. Retrieve + decrypt credential.
    let credential = await this.credentialStore.retrieve(account.id)
    if (credential === null) {
      throw AccountError.notFound('Credential', account.id)
    }

    const platform = platformFromAgentIdOrCursor(account.agentId)

    // 2. Refresh-before-switch（平台支持时）。刷新成功的新凭据立即回写存储，
    //    后续注入用新 token；刷新失败按原样抛出（切换失败，不写半残登录）。
    const refresher = this.refreshers?.refresher(platform)
    if (refresher !== undefined) {
      const refreshed = await refresher.refreshIfNeeded(credential)
      if (refreshed !== credential) {
        await this.credentialStore.store(account.id, platform, refreshed)
        credential = refreshed
      }
    }

    // 3. Validate not expired（无刷新能力或刷不动的平台维持原行为）。
    if (credential.isExpired()) {
      throw AccountError.credentialExpired(account.id)
    }

    // 4. Resolve injector for the account's platform.
    const injector = this.injectors.injector(platform)
    if (injector === undefined) {
      throw AccountError.notFound('PlatformAdapter', platform)
    }

    // 5. Inject, bracketed by the platform lifecycle（beforeInject 停不掉运行中
    //    的 App 会抛错中止；afterInject 在注入失败时也执行，恢复用户的 App）。
    const lifecycle = this.lifecycles?.lifecycle(platform)
    const token = lifecycle !== undefined ? await lifecycle.beforeInject() : undefined
    let platformLaunched = false
    try {
      await injector.inject(platform, credential)
    } finally {
      if (lifecycle !== undefined && token !== undefined) {
        try {
          await lifecycle.afterInject(token)
          platformLaunched = token.relaunch
        } catch (e) {
          // 拉起 App 失败不掩盖注入结果：注入已成功时切换算成功，只告警。
          console.warn(
            `[switch] afterInject 失败（凭据已写入）: ${e instanceof Error ? e.message : String(e)}`,
          )
        }
      }
    }

    return { success: true, platformLaunched }
  }
}
