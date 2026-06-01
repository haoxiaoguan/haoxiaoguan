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
  refreshToken?: string
  expiresAt?: Date
  rawMetadata?: JsonValue
  name?: string
  tags: string[]
  notes?: string
}

/**
 * AccountApplicationService — orchestrates account use cases.
 *
 * 对应 AccountApplicationService: import (two-phase write with
 * rollback), switch (deactivate current → inject → activate → persist), delete
 * (credential-first cascade), batch delete, filter, export, import-from-json.
 */
export class AccountApplicationService {
  constructor(
    private readonly accountRepo: AccountRepository,
    private readonly credentialStore: CredentialStorePort,
    private readonly switchService: SwitchService,
  ) {}

  /**
   * Import: derive profile → duplicate check → create aggregate → persist
   * account → encrypt+store credential (rollback account row on credential
   * failure). 对应 import_account.
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
      refreshToken?: string
      expiresAt?: Date
      rawMetadata?: JsonValue
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
   * SwitchService → activate target → persist. 对应 switch_account.
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
   * Delete: verify exists → delete credential first (cascade) → delete account
   * (tags cascade via DB FK). 对应 delete_account.
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
   * error. 对应 batch_delete.
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
   * 对应 filter_accounts.
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
   * credentials. 对应 export_accounts.
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
        // Source uses {:?} on PlatformId here (debug form), but the frontend id
        // is the stable, round-trippable representation; import_from_json parses
        // it case-insensitively. We emit the frontend id.
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
   * Import-from-json: parse → validate required fields (id/platform/email) →
   * apply conflict strategy (skip/overwrite/keep_both) → import each.
   * 对应 import_from_json.
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

      // Conflict check uses the raw email as the identity (source passes
      // export_account.email to exists_by_identifier, which normalizes it).
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
