import { Account } from '../domain/account'
import { AccountError } from '../domain/account-error'
import { Credential } from '../domain/credential'
import type { JsonValue } from '../domain/platform-account-profile'
import { profileFromImportMaterial } from '../domain/platform-profile'
import {
  type PlatformId,
  parsePlatformLoose,
  platformToFrontendId,
  platformFromAgentIdOrCursor,
} from '../domain/platform-id'
import type { AccountRepository } from '../domain/account-repository'
import type { CredentialStorePort } from '../domain/ports'
import type { CursorRefundFn, CursorRefundResult } from '../domain/cursor-refund'
import type {
  CursorCheckoutFn,
  CursorCheckoutTarget,
  CursorCheckoutTier,
} from '../domain/cursor-checkout'
import { SwitchService } from './switch-service'
import {
  type ConflictStrategy,
  type ExportAccount,
  type ExportData,
  type ImportResult,
} from './export-types'

export interface ImportAccountInput {
  platform: PlatformId
  email: string
  token: string
  refreshToken?: string | undefined
  expiresAt?: Date | undefined
  rawMetadata?: JsonValue | undefined
  name?: string | undefined
  tags: string[]
  notes?: string | undefined
}

/**
 * AccountApplicationService — orchestrates account use cases: import (two-phase
 * write with rollback), switch (deactivate current → inject → activate →
 * persist), delete (credential-first cascade), batch delete, filter, export,
 * import-from-json.
 */
export class AccountApplicationService {
  constructor(
    private readonly accountRepo: AccountRepository,
    private readonly credentialStore: CredentialStorePort,
    private readonly switchService: SwitchService,
    // Cursor 一键退款能力（可选注入）。缺省未配置时 refundCursorAccount 抛错。
    private readonly cursorRefund?: CursorRefundFn,
    // Cursor 充值开窗能力（可选注入）。缺省未配置时 openCursorCheckout 抛错。
    private readonly cursorCheckout?: CursorCheckoutFn,
  ) {}

  /**
   * Import: derive profile → duplicate check → create aggregate → persist
   * account → encrypt+store credential (rollback account row on credential
   * failure).
   */
  async importAccount(input: ImportAccountInput): Promise<Account> {
    const profile = profileFromImportMaterial(
      input.platform,
      input.email,
      input.rawMetadata,
      input.token,
    )

    // 1. Duplicate check by (platform, identity_key).
    if (await this.accountRepo.existsByIdentifier(input.platform, profile.identityKey)) {
      throw AccountError.duplicateIdentifier(profile.displayIdentifier, input.platform)
    }

    // 2. Create aggregate (validates business rules).
    const account = Account.createWithProfile(
      input.platform,
      input.email,
      input.name,
      input.tags,
      input.notes,
      profile,
    )

    // 3. Persist the account first; credentials.account_id FK → accounts.id.
    await this.accountRepo.save(account)

    // 4. Build the credential plaintext + 5. store encrypted. Roll back the
    //    account row if credential storage fails (two-phase write).
    const credential = new Credential(
      input.token,
      input.refreshToken,
      input.expiresAt,
      input.rawMetadata,
    )
    try {
      await this.credentialStore.store(account.id, input.platform, credential)
    } catch (err) {
      await this.accountRepo.delete(account.id).catch(() => undefined)
      throw err
    }

    return account
  }

  /**
   * Update editable user metadata (name / tags / notes). Identity-bearing
   * fields stay frozen — changing them would break duplicate detection and
   * quota correlation. The credential is left untouched (use re-authenticate
   * for that). Returns the refreshed aggregate.
   */
  async updateAccountMetadata(
    accountId: string,
    patch: { name?: string | null; tags?: string[]; notes?: string | null },
  ): Promise<Account> {
    const account = await this.accountRepo.findById(accountId)
    if (account === null) {
      throw AccountError.notFound('Account', accountId)
    }
    account.editMetadata(patch)
    await this.accountRepo.save(account)
    return account
  }

  /**
   * Re-authenticate: replace an account's credential without losing its id,
   * tags, notes, or group memberships.
   *
   * Identity guard: the new material's normalized identity MUST match the
   * existing account's identity_key. Re-auth is meant to refresh tokens for
   * the SAME upstream principal — letting "Alice" silently replace "Bob"'s
   * row would corrupt the user's mental model and break quota correlation.
   * If you genuinely want a different account, delete + import.
   *
   * On success: the credential is replaced through the same encrypted store
   * as import, and the profile payload is merged so any platform-side metadata
   * refresh (plan tier change, login provider, …) flows in.
   */
  async reauthenticate(
    accountId: string,
    input: {
      token: string
      refreshToken?: string | undefined
      expiresAt?: Date | undefined
      rawMetadata?: JsonValue | undefined
      /** New identifier the credential reports (email or platform identity). */
      identifier: string
    },
  ): Promise<Account> {
    const account = await this.accountRepo.findById(accountId)
    if (account === null) {
      throw AccountError.notFound('Account', accountId)
    }
    const platform = parsePlatformAgent(account.agentId)

    // Re-derive the profile from the new material under the SAME platform, so
    // identityKey is computed identically to the import path.
    const profile = profileFromImportMaterial(
      platform,
      input.identifier,
      input.rawMetadata,
      input.token,
    )
    const fallbackIdentifier =
      input.identifier.trim().length === 0 ? profile.displayIdentifier : input.identifier
    const normalized = profile.normalized(fallbackIdentifier)

    if (normalized.identityKey !== account.identityKey) {
      throw AccountError.invalidCredentialFormat(
        `Identity mismatch: existing '${account.identityKey}' vs new '${normalized.identityKey}'.`
          + ' Use a different account to import a different principal.',
      )
    }

    // Merge the new payload into the aggregate so derived fields (plan/status)
    // refresh; leave name/tags/notes untouched.
    account.updateProfilePayload(normalized.profilePayload)
    await this.accountRepo.save(account)

    // Replace the credential atomically. The credential store's `store` upserts
    // by accountId, so the previous envelope is overwritten.
    const credential = new Credential(
      input.token,
      input.refreshToken,
      input.expiresAt,
      input.rawMetadata,
    )
    await this.credentialStore.store(account.id, platform, credential)

    return account
  }

  /**
   * Switch: load target → deactivate current active for platform → inject via
   * SwitchService → activate target → persist.
   */
  async switchAccount(accountId: string): Promise<void> {
    const account = await this.accountRepo.findById(accountId)
    if (account === null) {
      throw AccountError.notFound('Account', accountId)
    }

    const platform = parsePlatformAgent(account.agentId)
    const currentActive = await this.accountRepo.findActiveByPlatform(platform)
    if (currentActive !== null && currentActive.id !== accountId) {
      currentActive.deactivate()
      await this.accountRepo.save(currentActive)
    }

    await this.switchService.switchAccount(account)

    account.activate()
    await this.accountRepo.save(account)
  }

  /**
   * Cursor 一键退款：解密账号凭证 → 交给注入的退款端口调 KC 后端接口 → 回传结果。
   * 仅 Cursor 账号；非 Cursor 或能力未配置时抛错。不可逆（退款后订阅立即转 Free、
   * token 失效），二次确认在 UI 层完成，本方法不做额外拦截。
   */
  async refundCursorAccount(accountId: string): Promise<CursorRefundResult> {
    const account = await this.accountRepo.findById(accountId)
    if (account === null) {
      throw AccountError.notFound('Account', accountId)
    }
    const platform = parsePlatformAgent(account.agentId)
    if (platform !== 'cursor') {
      throw AccountError.invalidCredentialFormat('退款仅支持 Cursor 账号')
    }
    if (this.cursorRefund === undefined) {
      throw AccountError.repositoryError('Cursor 退款能力未配置')
    }
    const credential = await this.credentialStore.retrieve(accountId)
    if (credential === null) {
      throw AccountError.notFound('Credential', accountId)
    }
    return this.cursorRefund(credential)
  }

  /**
   * Cursor 充值：打开对应档位（pro/pro_plus/ultra）的结账页。
   *   - target='embedded'：解密账号凭证 → 内嵌窗口注入登录 cookie 免登录直达本号结账；
   *   - target='chrome'：用系统 Chrome 打开（充值 Chrome 里登录的账号，无需本号凭证）。
   * 仅 Cursor 账号；付款由用户在结账页完成。
   */
  async openCursorCheckout(
    accountId: string,
    tier: CursorCheckoutTier,
    target: CursorCheckoutTarget,
  ): Promise<void> {
    const account = await this.accountRepo.findById(accountId)
    if (account === null) {
      throw AccountError.notFound('Account', accountId)
    }
    const platform = parsePlatformAgent(account.agentId)
    if (platform !== 'cursor') {
      throw AccountError.invalidCredentialFormat('充值仅支持 Cursor 账号')
    }
    if (this.cursorCheckout === undefined) {
      throw AccountError.repositoryError('Cursor 充值能力未配置')
    }
    // 内嵌免登录需要本号 access token；用 Chrome 打开走浏览器登录态，无需解密。
    let accessToken = ''
    if (target === 'embedded') {
      const credential = await this.credentialStore.retrieve(accountId)
      if (credential === null) {
        throw AccountError.notFound('Credential', accountId)
      }
      accessToken = credential.token
    }
    await this.cursorCheckout({ accessToken, tier, target })
  }

  /**
   * Delete: verify exists → delete credential first (cascade) → delete account
   * (tags cascade via DB FK).
   */
  async deleteAccount(accountId: string): Promise<void> {
    const account = await this.accountRepo.findById(accountId)
    if (account === null) {
      throw AccountError.notFound('Account', accountId)
    }
    await this.credentialStore.delete(accountId)
    await this.accountRepo.delete(accountId)
  }

  /**
   * Batch delete: iterate, skip NotFound, count successes; propagate any other
   * error.
   */
  async batchDelete(accountIds: string[]): Promise<number> {
    let deleted = 0
    for (const id of accountIds) {
      try {
        await this.deleteAccount(id)
        deleted += 1
      } catch (err) {
        if (err instanceof AccountError && err.kind === 'NotFound') continue
        throw err
      }
    }
    return deleted
  }

  /**
   * Filter: platform+tags intersection / platform only / tags only / empty.
   */
  async filterAccounts(
    platform: PlatformId | undefined,
    tags: string[] | undefined,
  ): Promise<Account[]> {
    if (platform !== undefined && tags !== undefined && tags.length > 0) {
      const byPlatform = await this.accountRepo.findByPlatform(platform)
      const byTags = await this.accountRepo.findByTags(tags)
      const tagIds = new Set(byTags.map((a) => a.id))
      return byPlatform.filter((a) => tagIds.has(a.id))
    }
    if (platform !== undefined) {
      return this.accountRepo.findByPlatform(platform)
    }
    if (tags !== undefined && tags.length > 0) {
      return this.accountRepo.findByTags(tags)
    }
    return []
  }

  /**
   * Export: serialize accounts to ExportData; optionally decrypt+include
   * credentials.
   */
  async exportAccounts(accountIds: string[], includeCredentials: boolean): Promise<ExportData> {
    const exportAccounts: ExportAccount[] = []
    for (const accountId of accountIds) {
      const account = await this.accountRepo.findById(accountId)
      if (account === null) {
        throw AccountError.notFound('Account', accountId)
      }

      let credential: ExportAccount['credential']
      if (includeCredentials) {
        const cred = await this.credentialStore.retrieve(accountId)
        if (cred !== null) {
          credential = {
            token: cred.token,
            refresh_token: cred.refreshToken ?? null,
          }
        }
      }

      exportAccounts.push({
        id: account.id,
        // The frontend id is the stable, round-trippable representation;
        // import_from_json parses it case-insensitively. We emit the frontend id.
        platform: platformToFrontendId(parsePlatformAgent(account.agentId)),
        email: account.email,
        name: account.name?.asStr() ?? null,
        tags: [...account.tags.asSlice()],
        notes: account.notes?.asStr() ?? null,
        is_active: account.isActive,
        created_at: account.createdAt.toISOString(),
        last_used_at: account.lastUsedAt ? account.lastUsedAt.toISOString() : null,
        ...(credential !== undefined ? { credential } : {}),
      })
    }

    return {
      version: '1.0',
      exported_at: new Date().toISOString(),
      accounts: exportAccounts,
    }
  }

  /**
   * cpa 格式导出：每个账号一个扁平 token JSON 对象
   * (id_token/access_token/refresh_token/account_id/last_refresh/email/type/expired)。
   * access/refresh token 取解密后的实时凭证；其余字段来自 raw_metadata（兼容顶层
   * 与 tokens 嵌套两种拼写）。raw_metadata 里的其他原始字段（如 kiro 的
   * clientId/provider）原样透传，保证导出结果能经 token-JSON 导入回灌。
   */
  async exportAccountsCpa(accountIds: string[]): Promise<JsonValue[]> {
    const out: JsonValue[] = []
    for (const accountId of accountIds) {
      const account = await this.accountRepo.findById(accountId)
      if (account === null) {
        throw AccountError.notFound('Account', accountId)
      }
      const cred = await this.credentialStore.retrieve(accountId)

      const raw: Record<string, unknown> =
        cred?.rawMetadata !== undefined &&
        typeof cred.rawMetadata === 'object' &&
        cred.rawMetadata !== null &&
        !Array.isArray(cred.rawMetadata)
          ? (cred.rawMetadata as Record<string, unknown>)
          : {}
      const nested: Record<string, unknown> =
        typeof raw.tokens === 'object' && raw.tokens !== null && !Array.isArray(raw.tokens)
          ? (raw.tokens as Record<string, unknown>)
          : {}
      const pick = (...keys: string[]): string | undefined => {
        for (const k of keys) {
          const v = raw[k] ?? nested[k]
          if (typeof v === 'string' && v.length > 0) return v
        }
        return undefined
      }

      const cpa: Record<string, JsonValue> = {}
      const idToken = pick('id_token', 'idToken')
      if (idToken !== undefined) cpa.id_token = idToken
      const accessToken = cred?.token || pick('access_token', 'accessToken', 'token')
      if (accessToken !== undefined && accessToken !== '') cpa.access_token = accessToken
      const refreshToken = cred?.refreshToken ?? pick('refresh_token', 'refreshToken')
      if (refreshToken !== undefined) cpa.refresh_token = refreshToken
      const cpaAccountId = pick('account_id', 'accountId')
      if (cpaAccountId !== undefined) cpa.account_id = cpaAccountId
      const lastRefresh = pick('last_refresh', 'lastRefresh')
      if (lastRefresh !== undefined) cpa.last_refresh = lastRefresh
      cpa.email = account.email
      cpa.type = platformToFrontendId(parsePlatformAgent(account.agentId))
      const expired = pick('expired') ?? cred?.expiresAt?.toISOString()
      if (expired !== undefined) cpa.expired = expired

      // 透传 raw_metadata 中未被上面接管的原始标量字段（跳过各种拼写的重复键）。
      const handled = new Set([
        'tokens', 'id_token', 'idToken', 'access_token', 'accessToken', 'token',
        'refresh_token', 'refreshToken', 'account_id', 'accountId',
        'last_refresh', 'lastRefresh', 'email', 'type',
        'expired', 'expires_at', 'expiresAt', 'expiry',
      ])
      for (const [k, v] of Object.entries(raw)) {
        if (handled.has(k) || k in cpa) continue
        if (v === null || typeof v === 'object') continue
        cpa[k] = v as JsonValue
      }

      out.push(cpa)
    }
    return out
  }

  /**
   * Import-from-json: parse → validate required fields (id/platform/email) →
   * apply conflict strategy (skip/overwrite/keep_both) → import each.
   */
  async importFromJson(data: string, conflictStrategy: ConflictStrategy): Promise<ImportResult> {
    let exportData: ExportData
    try {
      exportData = JSON.parse(data) as ExportData
    } catch (e) {
      throw AccountError.invalidCredentialFormat(
        `Invalid JSON format: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
    if (!Array.isArray(exportData.accounts)) {
      throw AccountError.invalidCredentialFormat('Invalid JSON format: missing accounts array')
    }

    // Validate required fields for every account before importing any.
    for (let idx = 0; idx < exportData.accounts.length; idx += 1) {
      const account = exportData.accounts[idx]
      if (!account.id) {
        throw AccountError.invalidCredentialFormat(
          `Account at index ${idx} is missing required field 'id'`,
        )
      }
      if (!account.platform) {
        throw AccountError.invalidCredentialFormat(
          `Account at index ${idx} is missing required field 'platform'`,
        )
      }
      if (!account.email) {
        throw AccountError.invalidCredentialFormat(
          `Account at index ${idx} is missing required field 'email'`,
        )
      }
    }

    let imported = 0
    let skipped = 0
    const errors: string[] = []

    for (const exportAccount of exportData.accounts) {
      let platform: PlatformId
      try {
        platform = parsePlatformLoose(exportAccount.platform)
      } catch (e) {
        errors.push(
          `Account '${exportAccount.email}': invalid platform '${exportAccount.platform}' - ${
            e instanceof Error ? e.message : String(e)
          }`,
        )
        continue
      }

      // Conflict check uses the raw email as the identity; existsByIdentifier
      // normalizes it.
      let exists = false
      try {
        exists = await this.accountRepo.existsByIdentifier(platform, exportAccount.email)
      } catch {
        exists = false
      }

      if (exists) {
        if (conflictStrategy === 'skip') {
          skipped += 1
          continue
        }
        if (conflictStrategy === 'overwrite') {
          const existingAccounts = await this.accountRepo.findByPlatform(platform)
          const existing = existingAccounts.find((a) => a.email === exportAccount.email)
          if (existing) {
            await this.deleteAccount(existing.id).catch(() => undefined)
          }
        }
        // keep_both: fall through, import creates a new UUID.
      }

      const token = exportAccount.credential?.token ?? 'imported_placeholder'
      const refreshToken = exportAccount.credential?.refresh_token ?? undefined

      try {
        await this.importAccount({
          platform,
          email: exportAccount.email,
          token,
          refreshToken,
          expiresAt: undefined,
          rawMetadata: undefined,
          name: exportAccount.name ?? undefined,
          tags: exportAccount.tags ?? [],
          notes: exportAccount.notes ?? undefined,
        })
        imported += 1
      } catch (e) {
        errors.push(`Account '${exportAccount.email}': ${e instanceof Error ? e.message : String(e)}`)
      }
    }

    return { imported, skipped, errors }
  }
}

// Reconstruct the platform enum from a stored agent_id (DB read path).
function parsePlatformAgent(agentId: string): PlatformId {
  return platformFromAgentIdOrCursor(agentId)
}
