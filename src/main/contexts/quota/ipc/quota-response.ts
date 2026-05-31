// Quota IPC response DTOs + mappers.
//
// Wire shapes match the renderer types (src/renderer/types) and the frontend IPC
// map (.omc/alignment/map_frontend_ipc.md §quotaService): camelCase fields,
// timestamps RFC3339, optional fields omitted when undefined. QuotaMetric /
// AccountQuotaState already serialise camelCase via the quota-state serde module.

import type { QuotaInfo, ModelQuota } from '../domain/quota'
import type { AccountQuotaState } from '../domain/quota-state'
import { accountQuotaStateToJson, type AccountQuotaStateJson } from '../domain/quota-state'
import type { QuotaRefreshResult } from '../application/quota-service'

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
