import type { Account } from '../domain/account'
import { AccountError } from '../domain/account-error'
import { Credential } from '../domain/credential'
import type { JsonValue } from '../domain/platform-account-profile'
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
    // Cursor 靠 cursorAuth/cachedEmail 显示当前账号。OAuth/Google 导入的凭证元数据里没有该
    // 字段，只从元数据取会漏 → 切号后 cachedEmail 残留上一个账号（accessToken 已切、显示没变，
    // 看着像没切）。用账号权威 email（heal 后的真实邮箱）兜底写入，对齐 cockpit 无条件写
    // cursorAuth/cachedEmail = account.email。
    const credForInject =
      platform === 'cursor' ? withCursorAccountEmail(credential, account.email) : credential

    const lifecycle = this.lifecycles?.lifecycle(platform)
    const token = lifecycle !== undefined ? await lifecycle.beforeInject() : undefined
    let platformLaunched = false
    try {
      await injector.inject(platform, credForInject)
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

function isPlainObject(value: JsonValue | undefined): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 返回一个把账号权威 email 写进 cursor_auth_raw.cachedEmail（+ 顶层 email）的 Credential 副本，
 * 供 Cursor 注入用（cursorAuth/cachedEmail 决定 Cursor 显示哪个账号）。email 为空则原样返回。
 */
function withCursorAccountEmail(credential: Credential, email: string): Credential {
  const trimmed = email.trim()
  if (trimmed.length === 0) return credential
  const meta: { [key: string]: JsonValue } = isPlainObject(credential.rawMetadata)
    ? { ...credential.rawMetadata }
    : {}
  const car: { [key: string]: JsonValue } = isPlainObject(meta.cursor_auth_raw)
    ? { ...meta.cursor_auth_raw }
    : {}
  car.cachedEmail = trimmed
  meta.cursor_auth_raw = car
  meta.email = trimmed
  return new Credential(credential.token, credential.refreshToken, credential.expiresAt, meta)
}
