import { ipcMain } from 'electron'
import { toIpcError } from '../../../ipc/error'
import { QUOTA_CHANNELS } from './quota-channels'
import {
  toAccountQuotaStateResponse,
  toCodexResetCreditsResponse,
  toQuotaRefreshResultResponse,
  toQuotaResponse,
  type AccountQuotaStateResponse,
  type CodexResetCreditsResponse,
  type QuotaRefreshResultResponse,
  type QuotaResponse,
} from './quota-response'
import type { QuotaApplicationService } from '../application/quota-service'

// Register the quota IPC handlers. Channels OWNED by this context:
//   refresh_quota, refresh_all_quotas, get_quota, get_quota_state,
//   refresh_quota_state.
// Each handler unwraps the renderer arg shape ({ accountId } — camelCase
// top-level), calls the application
// service, reshapes the result to the camelCase wire DTO, and wraps thrown
// errors via toIpcError so the rejection is a plain string.

export function registerQuotaHandlers(quotaService: QuotaApplicationService): void {
  // refresh_quota — args: { accountId } → QuotaResponse
  ipcMain.handle(
    QUOTA_CHANNELS.refreshQuota,
    async (_e, args: { accountId: string }): Promise<QuotaResponse> => {
      try {
        const quota = await quotaService.refreshQuota(args.accountId)
        return toQuotaResponse(quota)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )

  // refresh_all_quotas — args: (none) → QuotaRefreshResultResponse[]
  ipcMain.handle(
    QUOTA_CHANNELS.refreshAllQuotas,
    async (): Promise<QuotaRefreshResultResponse[]> => {
      try {
        const results = await quotaService.refreshAll()
        return results.map(toQuotaRefreshResultResponse)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )

  // get_quota — args: { accountId } → QuotaResponse
  ipcMain.handle(
    QUOTA_CHANNELS.getQuota,
    async (_e, args: { accountId: string }): Promise<QuotaResponse> => {
      try {
        const quota = await quotaService.getQuota(args.accountId)
        return toQuotaResponse(quota)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )

  // get_quota_state — args: { accountId } → AccountQuotaStateResponse
  ipcMain.handle(
    QUOTA_CHANNELS.getQuotaState,
    async (_e, args: { accountId: string }): Promise<AccountQuotaStateResponse> => {
      try {
        const state = await quotaService.getQuotaState(args.accountId)
        return toAccountQuotaStateResponse(state)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )

  // refresh_quota_state — args: { accountId } → AccountQuotaStateResponse
  ipcMain.handle(
    QUOTA_CHANNELS.refreshQuotaState,
    async (_e, args: { accountId: string }): Promise<AccountQuotaStateResponse> => {
      try {
        const state = await quotaService.refreshQuotaState(args.accountId)
        return toAccountQuotaStateResponse(state)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )

  // consume_codex_reset_credit — args: { accountId } → AccountQuotaStateResponse
  // 消耗一次 Codex 主动重置额度后回传刷新后的额度状态。
  ipcMain.handle(
    QUOTA_CHANNELS.consumeCodexResetCredit,
    async (_e, args: { accountId: string }): Promise<AccountQuotaStateResponse> => {
      try {
        const state = await quotaService.consumeCodexResetCredit(args.accountId)
        return toAccountQuotaStateResponse(state)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )

  // get_codex_reset_credits — args: { accountId } → CodexResetCreditsResponse
  // Codex 主动重置券明细（每张券过期时间），hover 展示用。
  ipcMain.handle(
    QUOTA_CHANNELS.getCodexResetCredits,
    async (_e, args: { accountId: string }): Promise<CodexResetCreditsResponse> => {
      try {
        const view = await quotaService.getCodexResetCredits(args.accountId)
        return toCodexResetCreditsResponse(view)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )
}
