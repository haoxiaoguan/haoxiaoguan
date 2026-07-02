// Quota IPC response DTOs + mappers.
//
// Wire shapes match the renderer types (src/renderer/types) and the frontend IPC
// map (.omc/alignment/map_frontend_ipc.md §quotaService): camelCase fields,
// timestamps RFC3339, optional fields omitted when undefined. QuotaMetric /
// AccountQuotaState already serialise camelCase via the quota-state serde module.

import type { QuotaInfo, ModelQuota } from '../domain/quota'
import type { AccountQuotaState } from '../domain/quota-state'
import { accountQuotaStateToJson, type AccountQuotaStateJson } from '../domain/quota-state'
import type { QuotaRefreshResult, CodexResetCreditsView } from '../application/quota-service'

export interface ModelQuotaResponse {
  modelName: string
  used: number
  total: number
  usagePercentage: number
  isWarning: boolean
  resetAt?: string
}

export interface QuotaResponse {
  accountId: string
  models: ModelQuotaResponse[]
  fetchedAt: string
}

export interface QuotaRefreshResultResponse {
  accountId: string
  success: boolean
  quota?: QuotaResponse
  error?: string
}

export type AccountQuotaStateResponse = AccountQuotaStateJson

export interface CodexResetCreditResponse {
  id?: string
  status?: string
  resetType?: string
  grantedAt?: number
  expiresAt?: number
  redeemedAt?: number
}

export interface CodexResetCreditsResponse {
  availableCount: number | null
  nextExpiresAt: number | null
  credits: CodexResetCreditResponse[]
}

export function toCodexResetCreditsResponse(view: CodexResetCreditsView): CodexResetCreditsResponse {
  return {
    availableCount: view.availableCount,
    nextExpiresAt: view.nextExpiresAt,
    credits: view.credits.map((c) => {
      const out: CodexResetCreditResponse = {}
      if (c.id !== undefined) out.id = c.id
      if (c.status !== undefined) out.status = c.status
      if (c.resetType !== undefined) out.resetType = c.resetType
      if (c.grantedAt !== undefined) out.grantedAt = c.grantedAt
      if (c.expiresAt !== undefined) out.expiresAt = c.expiresAt
      if (c.redeemedAt !== undefined) out.redeemedAt = c.redeemedAt
      return out
    }),
  }
}

function toModelQuotaResponse(model: ModelQuota): ModelQuotaResponse {
  const out: ModelQuotaResponse = {
    modelName: model.modelName,
    used: model.used,
    total: model.total,
    usagePercentage: model.usagePercentage(),
    isWarning: model.isWarning(),
  }
  if (model.resetAt !== undefined) out.resetAt = model.resetAt.toISOString()
  return out
}

export function toQuotaResponse(quota: QuotaInfo): QuotaResponse {
  return {
    accountId: quota.accountId,
    models: quota.models.map(toModelQuotaResponse),
    fetchedAt: quota.fetchedAt.toISOString(),
  }
}

export function toQuotaRefreshResultResponse(
  result: QuotaRefreshResult,
): QuotaRefreshResultResponse {
  const out: QuotaRefreshResultResponse = {
    accountId: result.accountId,
    success: result.success,
  }
  if (result.quota !== undefined) out.quota = toQuotaResponse(result.quota)
  if (result.error !== undefined) out.error = result.error
  return out
}

export function toAccountQuotaStateResponse(state: AccountQuotaState): AccountQuotaStateResponse {
  return accountQuotaStateToJson(state)
}
