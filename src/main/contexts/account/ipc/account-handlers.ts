import { ipcMain } from 'electron'
import { toIpcError } from '../../../ipc/error'
import { ACCOUNT_CHANNELS } from './account-channels'
import { type AccountResponse, toAccountResponse } from './account-response'
import { parsePlatform } from '../domain/platform-id'
import type { JsonValue } from '../domain/platform-account-profile'
import type { AccountApplicationService } from '../application/account-service'
import type { CursorRefundResult } from '../domain/cursor-refund'
import type { CursorCheckoutTarget, CursorCheckoutTier } from '../domain/cursor-checkout'
import type { SwitchOrchestrator } from '../application/switch-orchestrator'
import type { ValidationService } from '../application/validation-service'
import type { AccountHealthService } from '../application/health-service'
import type { ActiveDetectionService } from '../application/active-detection-service'
import type { ConflictStrategy } from '../application/export-types'

// Request DTOs as the renderer sends them (src/renderer/services/tauri.ts +
// src/renderer/types). Top-level args are camelCase; the wrapped `request`
// objects ALSO use camelCase inner fields (refreshToken, accountIds,
// includeCredentials, conflictStrategy) — this is the actual frontend contract.

interface ImportAccountRequest {
  platform: string
  email: string
  token: string
  refreshToken?: string
  expiresAt?: string
  rawMetadata?: JsonValue
  name?: string
  tags: string[]
  notes?: string
}

interface FilterAccountsRequest {
  platform?: string
  tags?: string[]
}

interface BatchDeleteRequest {
  accountIds: string[]
}

interface ExportAccountsRequest {
  accountIds: string[]
  includeCredentials: boolean
}

interface ImportAccountsRequest {
  data: string
  conflictStrategy: ConflictStrategy
}

interface UpdateAccountRequest {
  accountId: string
  patch: { name?: string | null; tags?: string[]; notes?: string | null }
}

interface ReauthenticateRequest {
  accountId: string
  identifier: string
  token: string
  refreshToken?: string
  expiresAt?: string
  rawMetadata?: JsonValue
}

const MAX_IMPORT_SIZE = 50 * 1024 * 1024 // 50MB

export interface AccountHandlerDeps {
  accountService: AccountApplicationService
  switchOrchestrator: SwitchOrchestrator
  validationService: ValidationService
  healthService: AccountHealthService
  activeDetection: ActiveDetectionService
}

/**
 * Register all account/health/switch-v2 IPC handlers. Each handler unwraps the
 * exact arg shape the renderer sends, calls the application service, reshapes
 * the result to the wire DTO, and wraps thrown errors via toIpcError (so the
 * rejection is a plain string, matching Tauri invoke semantics).
 */
export function registerAccountHandlers(deps: AccountHandlerDeps): void {
  const { accountService, switchOrchestrator, validationService, healthService, activeDetection } = deps

  // import_account — args: { request: ImportAccountRequest } → AccountResponse
  ipcMain.handle(
    ACCOUNT_CHANNELS.importAccount,
    async (_e, args: { request: ImportAccountRequest }): Promise<AccountResponse> => {
      try {
        const req = args.request
        const account = await accountService.importAccount({
          platform: parsePlatform(req.platform),
          email: req.email,
          token: req.token,
          refreshToken: req.refreshToken,
          expiresAt: req.expiresAt ? parseRfc3339(req.expiresAt) : undefined,
          rawMetadata: req.rawMetadata,
          name: req.name,
          tags: req.tags,
          notes: req.notes,
        })
        return toAccountResponse(account)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )

  // switch_account — args: { accountId } → void
  ipcMain.handle(ACCOUNT_CHANNELS.switchAccount, async (_e, args: { accountId: string }) => {
    try {
      await accountService.switchAccount(args.accountId)
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  // delete_account — args: { accountId } → void
  ipcMain.handle(ACCOUNT_CHANNELS.deleteAccount, async (_e, args: { accountId: string }) => {
    try {
      await accountService.deleteAccount(args.accountId)
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  // update_account — args: { accountId, patch:{name?,tags?,notes?} } → AccountResponse
  ipcMain.handle(
    ACCOUNT_CHANNELS.updateAccount,
    async (_e, args: UpdateAccountRequest): Promise<AccountResponse> => {
      try {
        const account = await accountService.updateAccountMetadata(args.accountId, args.patch)
        return toAccountResponse(account)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )

  // reauthenticate — args: { accountId, identifier, token, ... } → AccountResponse
  ipcMain.handle(
    ACCOUNT_CHANNELS.reauthenticate,
    async (_e, args: ReauthenticateRequest): Promise<AccountResponse> => {
      try {
        const account = await accountService.reauthenticate(args.accountId, {
          identifier: args.identifier,
          token: args.token,
          refreshToken: args.refreshToken,
          expiresAt: args.expiresAt ? parseRfc3339(args.expiresAt) : undefined,
          rawMetadata: args.rawMetadata,
        })
        return toAccountResponse(account)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )

  // batch_delete — args: { request: { accountIds } } → { deletedCount }
  ipcMain.handle(
    ACCOUNT_CHANNELS.batchDelete,
    async (_e, args: { request: BatchDeleteRequest }): Promise<{ deletedCount: number }> => {
      try {
        const deletedCount = await accountService.batchDelete(args.request.accountIds)
        return { deletedCount }
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )

  // filter_accounts — args: { request: FilterAccountsRequest } → AccountResponse[]
  ipcMain.handle(
    ACCOUNT_CHANNELS.filterAccounts,
    async (_e, args: { request: FilterAccountsRequest }): Promise<AccountResponse[]> => {
      try {
        const platform = args.request.platform ? parsePlatform(args.request.platform) : undefined
        const accounts = await accountService.filterAccounts(platform, args.request.tags)
        return accounts.map(toAccountResponse)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )

  // get_accounts_by_platform — args: { platform } → AccountResponse[]
  ipcMain.handle(
    ACCOUNT_CHANNELS.getAccountsByPlatform,
    async (_e, args: { platform: string }): Promise<AccountResponse[]> => {
      try {
        const platform = parsePlatform(args.platform)
        const accounts = await accountService.filterAccounts(platform, undefined)
        return accounts.map(toAccountResponse)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )

  // export_accounts — args: { request: ExportAccountsRequest } → string (pretty JSON)
  ipcMain.handle(
    ACCOUNT_CHANNELS.exportAccounts,
    async (_e, args: { request: ExportAccountsRequest }): Promise<string> => {
      try {
        const exportData = await accountService.exportAccounts(
          args.request.accountIds,
          args.request.includeCredentials,
        )
        return JSON.stringify(exportData, null, 2)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )

  // export_accounts_cpa — args: { accountIds } → string（cpa 格式 pretty JSON：1 个账号为对象，多个为数组）
  ipcMain.handle(
    ACCOUNT_CHANNELS.exportAccountsCpa,
    async (_e, args: { accountIds: string[] }): Promise<string> => {
      try {
        const list = await accountService.exportAccountsCpa(args.accountIds)
        const payload = list.length === 1 ? list[0] : list
        return JSON.stringify(payload, null, 2)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )

  // import_accounts — args: { request: ImportAccountsRequest } → { imported, skipped, errors }
  ipcMain.handle(
    ACCOUNT_CHANNELS.importAccounts,
    async (_e, args: { request: ImportAccountsRequest }) => {
      try {
        const req = args.request
        if (req.data.length > MAX_IMPORT_SIZE) {
          throw new Error(
            `Import data exceeds maximum size of 50MB (actual: ${req.data.length} bytes)`,
          )
        }
        if (
          req.conflictStrategy !== 'skip' &&
          req.conflictStrategy !== 'overwrite' &&
          req.conflictStrategy !== 'keep_both'
        ) {
          throw new Error(
            `Invalid conflict strategy: '${String(
              req.conflictStrategy,
            )}'. Must be 'skip', 'overwrite', or 'keep_both'`,
          )
        }
        return await accountService.importFromJson(req.data, req.conflictStrategy)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )

  // switch_account_v2 — args: { accountId, launchOnSwitch?, executableOverride? } → void
  ipcMain.handle(
    ACCOUNT_CHANNELS.switchAccountV2,
    async (
      _e,
      args: { accountId: string; launchOnSwitch?: boolean; executableOverride?: string },
    ) => {
      try {
        await switchOrchestrator.switch(args.accountId, {
          launchOnSwitch: args.launchOnSwitch ?? false,
          executableOverride: args.executableOverride,
        })
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )

  // validate_credential — args: { accountId } → CredentialValidationResult
  ipcMain.handle(
    ACCOUNT_CHANNELS.validateCredential,
    async (_e, args: { accountId: string }) => {
      try {
        return await validationService.validate(args.accountId)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )

  // get_account_health — args: { accountId } → HealthSnapshot
  ipcMain.handle(
    ACCOUNT_CHANNELS.getAccountHealth,
    async (_e, args: { accountId: string }) => {
      try {
        return await healthService.snapshot(args.accountId)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )

  // validate_batch — args: { accountIds, concurrency? } →
  //   Array<{account_id, result} | {account_id, error}>  (snake_case wire shape)
  ipcMain.handle(
    ACCOUNT_CHANNELS.validateBatch,
    async (_e, args: { accountIds: string[]; concurrency?: number }) => {
      try {
        const items = await validationService.validateBatch(
          args.accountIds,
          args.concurrency ?? 4,
        )
        return items.map((item) =>
          item.error !== undefined
            ? { account_id: item.accountId, error: item.error }
            : { account_id: item.accountId, result: item.result },
        )
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )

  // refund_cursor — args: { accountId } → CursorRefundResult (camelCase DTO,
  // already serializable). 对 Cursor 账号发起一键退款（不可逆，二次确认在 UI 层）。
  ipcMain.handle(
    ACCOUNT_CHANNELS.refundCursor,
    async (_e, args: { accountId: string }): Promise<CursorRefundResult> => {
      try {
        return await accountService.refundCursorAccount(args.accountId)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )

  // open_cursor_checkout — args: { accountId, tier, target } → void。打开 Cursor 充值页
  // （embedded=内嵌窗口注入 cookie 免登录本号；chrome=系统 Chrome 用其登录态）。
  ipcMain.handle(
    ACCOUNT_CHANNELS.openCursorCheckout,
    async (
      _e,
      args: { accountId: string; tier: CursorCheckoutTier; target: CursorCheckoutTarget },
    ): Promise<void> => {
      try {
        await accountService.openCursorCheckout(args.accountId, args.tier, args.target)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )

  // detect_active_accounts — reverse-detect which account each IDE is actually
  // logged into, rewrite is_active, and return the per-platform outcome.
  ipcMain.handle(ACCOUNT_CHANNELS.detectActiveAccounts, async () => {
    try {
      return await activeDetection.detectAll()
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })
}

// Parse an RFC3339 string to a Date; throw a clear error on a bad value.
function parseRfc3339(value: string): Date {
  const ms = Date.parse(value)
  if (Number.isNaN(ms)) {
    throw new Error(`Invalid datetime '${value}'`)
  }
  return new Date(ms)
}
