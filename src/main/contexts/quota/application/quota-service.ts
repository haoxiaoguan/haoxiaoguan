// QuotaApplicationService — orchestrates quota refresh, caching, and normalisation.
//
// Use cases:
//  - refreshQuota: load account → decrypt credential → live fetch → merge refresh
//    metadata → persist updated credential + account profile_payload → save
//    quota_cache + account_quota_state (state save is fire-and-forget).
//  - refreshAll: concurrent per-account refresh with error isolation.
//  - getQuota: cache-first with live fallback.
//  - refreshQuotaState / getQuotaState: normalised AccountQuotaState with the
//    multi-tier read (cached state → profile parse → quota_cache → live refresh).

import type { JsonValue } from '../../account/domain/platform-account-profile'
import { Account } from '../../account/domain/account'
import { Credential } from '../../account/domain/credential'
import { platformFromAgentIdOrCursor } from '../../account/domain/platform-id'
import { QuotaError } from '../domain/quota-error'
import { ModelQuota, QuotaInfo } from '../domain/quota'
import type { PlatformId } from '../domain/platform-id'
import type {
  LiveQuotaFetcher,
  QuotaAccountRepository,
  QuotaCacheRepository,
  QuotaCredentialStore,
  QuotaStateRepository,
  AccountDispatcherResolver,
} from '../domain/ports'
import { runWithDispatcher } from '../../../platform/net/dispatcher-context'
import {
  AccountQuotaState,
  fromAccountProfile,
  fromFetchResultForPlatform,
  sanitizeProviderPayload,
  type QuotaMetric,
} from '../domain/quota-state'

/** Per-account result of refreshAll (error-isolated). */
export interface QuotaRefreshResult {
  accountId: string
  success: boolean
  quota?: QuotaInfo
  error?: string
}

/** The 12 platforms HttpLiveQuotaFetcher can fetch (the supported list when all
 *  adapters registered). refreshAll enumerates accounts across these. */
export const QUOTA_FETCH_PLATFORMS: readonly PlatformId[] = [
  'cursor',
  'windsurf',
  'kiro',
  'github_copilot',
  'codex',
  'gemini_cli',
  'codebuddy',
  'codebuddy_cn',
  'qoder',
  'trae',
  'zed',
  'antigravity',
]

const NIL_UUID = '00000000-0000-0000-0000-000000000000'

export class QuotaApplicationService {
  constructor(
    private readonly accountRepo: QuotaAccountRepository,
    private readonly credentialStore: QuotaCredentialStore,
    private readonly quotaCache: QuotaCacheRepository,
    private readonly quotaStateCache: QuotaStateRepository,
    private readonly quotaFetcher: LiveQuotaFetcher,
    private readonly supportedPlatforms: readonly PlatformId[] = QUOTA_FETCH_PLATFORMS,
    private readonly dispatcherResolver?: AccountDispatcherResolver,
  ) {}

  /** Refresh quota for a single account (live fetch + cache update). */
  async refreshQuota(accountId: string): Promise<QuotaInfo> {
    const account = await this.accountRepo.findById(accountId)
    if (account === null) throw QuotaError.notFound('Account', accountId)

    const credential = await this.decryptCredential(accountId)
    const platform = platformFromAgentIdOrCursor(account.agentId)

    // Resolve the per-account proxy dispatcher (undefined = direct). Set as the
    // ambient dispatcher for the duration of the live fetch so common.httpFetch
    // routes every outbound quota request through it. Per-async-context, so
    // concurrent refreshAll() accounts never cross dispatchers.
    const dispatcher =
      this.dispatcherResolver !== undefined
        ? await this.dispatcherResolver.dispatcherForAccount(accountId)
        : undefined

    let result
    try {
      result = await runWithDispatcher(dispatcher, () =>
        this.quotaFetcher.fetch({
          accountId,
          platform,
          credential,
          profilePayload: account.profilePayload,
        }),
      )
    } catch (e) {
      const message = errorMessage(e)
      await this.recordFailedQuotaRefresh(account, accountId, message)
      throw e instanceof Error ? e : new Error(message)
    }

    result.providerPayload = providerPayloadWithRefreshMetadata(
      result.providerPayload,
      result.fetchedAt,
    )
    if (result.updatedCredential !== undefined) {
      const uc = result.updatedCredential
      const mergedMetadata = mergePayloadValues(uc.rawMetadata, result.providerPayload)
      result.updatedCredential = new Credential(uc.token, uc.refreshToken, uc.expiresAt, mergedMetadata)
      await this.storeCredential(accountId, platform, result.updatedCredential)
    }

    if (hasProviderPayload(result.providerPayload)) {
      account.updateProfilePayload(sanitizeProviderPayload(result.providerPayload))
      // 自愈显示身份：Kiro 账号若导入时 email 缺失，displayIdentifier 会落到不透明
      // userId（如 d-xxx.uuid）；一旦在线刷新取回 email，提升为可读显示名。
      // identityKey 冻结 → 唯一性/额度关联安全（见 account.healDisplayIdentity）。
      if (platform === 'kiro') {
        const liveEmail = readLiveEmail(result.providerPayload)
        if (liveEmail !== undefined) account.healDisplayIdentity(liveEmail)
      }
      await this.accountRepo.save(account)
    }

    const credentialForState = result.updatedCredential ?? credential
    const quotaState = fromFetchResultForPlatform(
      platform,
      result,
      credentialForState.rawMetadata,
    ).sanitized()

    let models = result.models
    if (models.length === 0) models = modelsFromQuotaState(quotaState)
    const quotaInfo = new QuotaInfo(accountId, models, result.fetchedAt)

    await this.quotaCache.save(quotaInfo)
    await this.saveQuotaStateSilently(accountId, quotaState)

    return quotaInfo
  }

  /** Refresh all accounts concurrently, isolating per-account failures. */
  async refreshAll(): Promise<QuotaRefreshResult[]> {
    const allAccounts: Account[] = []
    for (const platform of this.supportedPlatforms) {
      try {
        const accounts = await this.accountRepo.findByPlatform(platform)
        allAccounts.push(...accounts)
      } catch {
        // skip platforms with repo errors
      }
    }

    const settled = await Promise.allSettled(
      allAccounts.map(async (account): Promise<QuotaRefreshResult> => {
        const accountId = account.id
        try {
          const quota = await this.refreshQuota(accountId)
          return { accountId, success: true, quota, error: undefined }
        } catch (e) {
          return { accountId, success: false, quota: undefined, error: errorMessage(e) }
        }
      }),
    )

    return settled.map((outcome) =>
      outcome.status === 'fulfilled'
        ? outcome.value
        : { accountId: NIL_UUID, success: false, quota: undefined, error: `Task panicked: ${errorMessage(outcome.reason)}` },
    )
  }

  /** Cache-first read with live fallback. */
  async getQuota(accountId: string): Promise<QuotaInfo> {
    try {
      const cached = await this.quotaCache.get(accountId)
      if (cached !== null) return cached
    } catch {
      // fall through to live refresh
    }
    return this.refreshQuota(accountId)
  }

  /** Live refresh then return the normalised state. */
  async refreshQuotaState(accountId: string): Promise<AccountQuotaState> {
    const quotaInfo = await this.refreshQuota(accountId)
    try {
      const cached = await this.quotaStateCache.get(accountId)
      if (cached !== null) return cached
    } catch {
      // fall through
    }
    return this.cacheQuotaState(accountId, quotaInfo)
  }

  /** Multi-tier read: cached state → profile parse → quota_cache → live refresh. */
  async getQuotaState(accountId: string): Promise<AccountQuotaState> {
    try {
      const cached = await this.quotaStateCache.get(accountId)
      if (cached !== null && !(await this.shouldIgnoreCachedQuotaState(accountId, cached))) {
        return cached
      }
    } catch {
      // fall through
    }

    const profileState = await this.getProfileQuotaState(accountId)
    if (profileState !== undefined) {
      const sanitized = profileState.sanitized()
      await this.saveQuotaStateSilently(accountId, sanitized)
      return sanitized
    }

    const quotaInfo = await this.getQuota(accountId)
    try {
      const cached = await this.quotaStateCache.get(accountId)
      if (cached !== null) return cached
    } catch {
      // fall through
    }
    return this.cacheQuotaState(accountId, quotaInfo)
  }

  // --- private helpers ---

  private async shouldIgnoreCachedQuotaState(
    accountId: string,
    state: AccountQuotaState,
  ): Promise<boolean> {
    if (!isLegacyCodexApiUsageState(state)) return false
    try {
      const account = await this.accountRepo.findById(accountId)
      return account !== null && platformFromAgentIdOrCursor(account.agentId) === 'codex'
    } catch {
      return false
    }
  }

  private async getProfileQuotaState(accountId: string): Promise<AccountQuotaState | undefined> {
    const account = await this.accountRepo.findById(accountId)
    if (account === null) throw QuotaError.notFound('Account', accountId)
    let rawMetadata: JsonValue | undefined
    try {
      const credential = await this.decryptCredential(accountId)
      rawMetadata = credential.rawMetadata
    } catch {
      rawMetadata = undefined
    }
    return fromAccountProfile(
      platformFromAgentIdOrCursor(account.agentId),
      account.profilePayload,
      rawMetadata,
    )
  }

  private async cacheQuotaState(accountId: string, quotaInfo: QuotaInfo): Promise<AccountQuotaState> {
    const state = AccountQuotaState.fromLegacyQuota(quotaInfo).sanitized()
    await this.saveQuotaStateSilently(accountId, state)
    return state
  }

  private async decryptCredential(accountId: string): Promise<Credential> {
    const credential = await this.credentialStore.retrieve(accountId)
    if (credential === null) throw QuotaError.notFound('Credential', accountId)
    return credential
  }

  private async storeCredential(
    accountId: string,
    platform: PlatformId,
    credential: Credential,
  ): Promise<void> {
    await this.credentialStore.store(accountId, platform, credential)
  }

  private async recordFailedQuotaRefresh(
    account: Account,
    accountId: string,
    message: string,
  ): Promise<void> {
    const fetchedAt = new Date()
    const ts = Math.trunc(fetchedAt.getTime() / 1000)
    const failurePayload: JsonValue = {
      quotaQueryLastError: message,
      quota_query_last_error: message,
      quotaQueryLastErrorAt: ts,
      quota_query_last_error_at: ts,
    }
    account.updateProfilePayload(sanitizeProviderPayload(failurePayload))
    try {
      await this.accountRepo.save(account)
    } catch {
      // best-effort
    }

    const state = new AccountQuotaState({
      version: 1,
      status: 'error',
      primaryMetricKey: undefined,
      metrics: [],
      fetchedAt,
      error: message,
      providerPayload: sanitizeProviderPayload(account.profilePayload),
    })
    await this.saveQuotaStateSilently(accountId, state)
  }

  private async saveQuotaStateSilently(
    accountId: string,
    state: AccountQuotaState,
  ): Promise<void> {
    try {
      await this.quotaStateCache.save(accountId, state)
    } catch {
      // quota_state save failures are non-fatal (fire-and-forget).
    }
  }
}

// ---------------------------------------------------------------------------
// module helpers
// ---------------------------------------------------------------------------

function providerPayloadWithRefreshMetadata(payload: JsonValue, fetchedAt: Date): JsonValue {
  const ts = Math.trunc(fetchedAt.getTime() / 1000)
  return mergePayloadValues(payload, {
    usageUpdatedAt: ts,
    usage_updated_at: ts,
    quotaQueryLastError: null,
    quota_query_last_error: null,
    quotaQueryLastErrorAt: null,
    quota_query_last_error_at: null,
  })
}

function mergePayloadValues(left: JsonValue | undefined, right: JsonValue): JsonValue {
  const merged: { [key: string]: JsonValue } =
    isPlainObject(left) ? { ...left } : {}
  if (isPlainObject(right)) {
    for (const [key, value] of Object.entries(right)) merged[key] = value
  }
  return merged
}

function isPlainObject(value: JsonValue | undefined): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasProviderPayload(value: JsonValue): boolean {
  if (value === null || value === undefined) return false
  if (isPlainObject(value)) return Object.keys(value).length > 0
  return true
}

/** Kiro 在线刷新已把 userInfo.email 展平到 providerPayload.email；仅取合法 email。 */
function readLiveEmail(payload: JsonValue): string | undefined {
  if (!isPlainObject(payload)) return undefined
  const email = payload.email
  return typeof email === 'string' && email.includes('@') ? email : undefined
}

function isLegacyCodexApiUsageState(state: AccountQuotaState): boolean {
  return (
    state.primaryMetricKey === 'api_usage' ||
    state.metrics.some((metric) => metric.key === 'api_usage')
  )
}

function modelsFromQuotaState(state: AccountQuotaState): ModelQuota[] {
  const models: ModelQuota[] = []
  for (const metric of state.metrics) {
    const total = totalForMetric(metric)
    if (total === undefined) continue
    const totalRounded = Math.max(0, Math.round(total))
    const used = usedForMetric(metric)
    const usedRounded = Math.max(0, Math.round(used))
    models.push(
      new ModelQuota(metric.key, usedRounded, Math.max(totalRounded, usedRounded), metric.resetAt),
    )
  }
  return models
}

function totalForMetric(metric: QuotaMetric): number | undefined {
  if (metric.total !== undefined) return metric.total
  if (metric.percentUsed !== undefined || metric.percentRemaining !== undefined) return 100
  return undefined
}

function usedForMetric(metric: QuotaMetric): number {
  if (metric.used !== undefined) return metric.used
  if (metric.percentUsed !== undefined) return clamp(metric.percentUsed, 0, 100)
  if (metric.percentRemaining !== undefined) return Math.max(0, 100 - clamp(metric.percentRemaining, 0, 100))
  return 0
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}
