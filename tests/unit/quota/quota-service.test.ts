import { describe, it, expect } from 'vitest'
import { Account } from '../../../src/main/contexts/account/domain/account'
import { Credential } from '../../../src/main/contexts/account/domain/credential'
import { QuotaApplicationService } from '../../../src/main/contexts/quota/application/quota-service'
import { ModelQuota, QuotaInfo } from '../../../src/main/contexts/quota/domain/quota'
import type {
  LiveQuotaFetcher,
  QuotaAccountRepository,
  QuotaCacheRepository,
  QuotaCredentialStore,
  QuotaFetchRequest,
  QuotaStateRepository,
} from '../../../src/main/contexts/quota/domain/ports'
import type { AccountQuotaState } from '../../../src/main/contexts/quota/domain/quota-state'
import type { QuotaFetchResult } from '../../../src/main/contexts/quota/domain/capabilities'
import type { PlatformId } from '../../../src/main/contexts/quota/domain/platform-id'

// Fakes mirror the Rust quota_service.rs mocks.

class FakeAccountRepo implements QuotaAccountRepository {
  constructor(private accounts: Account[]) {}
  async findById(id: string): Promise<Account | null> {
    return this.accounts.find((a) => a.id === id) ?? null
  }
  async findByPlatform(platform: PlatformId): Promise<Account[]> {
    return this.accounts.filter((a) => a.agentId === platform)
  }
  async save(account: Account): Promise<void> {
    const idx = this.accounts.findIndex((a) => a.id === account.id)
    if (idx >= 0) this.accounts[idx] = account
    else this.accounts.push(account)
  }
}

class FakeCredentialStore implements QuotaCredentialStore {
  stored: Credential | undefined
  constructor(private credential: Credential | null) {}
  async retrieve(): Promise<Credential | null> {
    return this.credential
  }
  async store(_accountId: string, _platform: PlatformId, credential: Credential): Promise<void> {
    this.stored = credential
    this.credential = credential
  }
}

class FakeQuotaCache implements QuotaCacheRepository {
  cached: QuotaInfo | null
  constructor(cached: QuotaInfo | null = null) {
    this.cached = cached
  }
  async get(): Promise<QuotaInfo | null> {
    return this.cached
  }
  async save(quota: QuotaInfo): Promise<void> {
    this.cached = quota
  }
  async delete(): Promise<void> {
    this.cached = null
  }
}

class FakeQuotaStateCache implements QuotaStateRepository {
  state: AccountQuotaState | null
  constructor(state: AccountQuotaState | null = null) {
    this.state = state
  }
  async get(): Promise<AccountQuotaState | null> {
    return this.state
  }
  async save(_accountId: string, state: AccountQuotaState): Promise<void> {
    this.state = state
  }
  async delete(): Promise<void> {
    this.state = null
  }
}

class FailingQuotaStateCache implements QuotaStateRepository {
  async get(): Promise<AccountQuotaState | null> {
    throw new Error('quota state read failed')
  }
  async save(): Promise<void> {
    throw new Error('quota state save failed')
  }
  async delete(): Promise<void> {
    throw new Error('quota state delete failed')
  }
}

class StaticFetcher implements LiveQuotaFetcher {
  constructor(private result: QuotaFetchResult) {}
  async fetch(_request: QuotaFetchRequest): Promise<QuotaFetchResult> {
    return this.result
  }
}

class FailingFetcher implements LiveQuotaFetcher {
  constructor(private message: string) {}
  async fetch(): Promise<QuotaFetchResult> {
    throw new Error(this.message)
  }
}

class SlowTrackingFetcher implements LiveQuotaFetcher {
  active = 0
  maxActive = 0

  async fetch(): Promise<QuotaFetchResult> {
    this.active++
    this.maxActive = Math.max(this.maxActive, this.active)
    await new Promise((resolve) => setTimeout(resolve, 5))
    this.active--
    return legacyModelsResult()
  }
}

function makeAccount(platform: PlatformId = 'cursor'): Account {
  return Account.create(platform, 'test@example.com', undefined, [], undefined)
}

function legacyModelsResult(): QuotaFetchResult {
  return {
    outcome: 'success',
    source: 'live',
    freshness: 'fresh',
    fetchedAt: new Date(),
    models: [new ModelQuota('gpt-4', 50, 100)],
    providerPayload: null,
    updatedCredential: undefined,
    error: undefined,
  }
}

function cursorPayloadResult(): QuotaFetchResult {
  return {
    outcome: 'success',
    source: 'live',
    freshness: 'fresh',
    fetchedAt: new Date(),
    models: [],
    providerPayload: {
      cursor_usage_raw: { individualUsage: { plan: { used: 20, limit: 80, autoPercentUsed: 10 } } },
    },
    updatedCredential: undefined,
    error: undefined,
  }
}

describe('QuotaApplicationService.refreshQuota', () => {
  it('returns models from a legacy live fetch', async () => {
    const account = makeAccount()
    const svc = new QuotaApplicationService(
      new FakeAccountRepo([account]),
      new FakeCredentialStore(new Credential('tok')),
      new FakeQuotaCache(),
      new FakeQuotaStateCache(),
      new StaticFetcher(legacyModelsResult()),
    )
    const quota = await svc.refreshQuota(account.id)
    expect(quota.accountId).toBe(account.id)
    expect(quota.models[0].modelName).toBe('gpt-4')
  })

  it('throws NotFound when the account is missing', async () => {
    const svc = new QuotaApplicationService(
      new FakeAccountRepo([]),
      new FakeCredentialStore(new Credential('tok')),
      new FakeQuotaCache(),
      new FakeQuotaStateCache(),
      new StaticFetcher(legacyModelsResult()),
    )
    await expect(svc.refreshQuota('missing')).rejects.toThrow(/Account/)
  })

  it('updates account profile payload from live provider payload', async () => {
    const account = makeAccount()
    const repo = new FakeAccountRepo([account])
    const svc = new QuotaApplicationService(
      repo,
      new FakeCredentialStore(new Credential('tok')),
      new FakeQuotaCache(),
      new FakeQuotaStateCache(),
      new StaticFetcher({
        ...cursorPayloadResult(),
        providerPayload: {
          planName: 'Cursor Pro',
          status: 'normal',
          cursor_usage_raw: { individualUsage: { plan: { used: 20, limit: 80 } } },
        },
      }),
    )
    await svc.refreshQuota(account.id)
    const saved = await repo.findById(account.id)
    expect(saved!.planName).toBe('Cursor Pro')
    expect(saved!.status).toBe('normal')
    const payload = saved!.profilePayload as any
    expect(payload.cursor_usage_raw.individualUsage.plan.used).toBe(20)
    expect(typeof payload.usageUpdatedAt).toBe('number')
    expect(payload.usage_updated_at).toBe(payload.usageUpdatedAt)
  })

  it('heals a kiro account opaque displayIdentifier with the live email (identityKey frozen)', async () => {
    // 导入时 email 缺失 → displayIdentifier 落到不透明 userId；刷新取回 email 后自愈。
    const account = Account.create('kiro', 'd-9067-abc', undefined, [], undefined)
    expect(account.displayIdentifier).toBe('d-9067-abc')
    const keyBefore = account.identityKey
    const repo = new FakeAccountRepo([account])
    const svc = new QuotaApplicationService(
      repo,
      new FakeCredentialStore(new Credential('tok')),
      new FakeQuotaCache(),
      new FakeQuotaStateCache(),
      new StaticFetcher({
        outcome: 'success',
        source: 'live',
        freshness: 'fresh',
        fetchedAt: new Date(),
        models: [new ModelQuota('credits', 0, 50)],
        providerPayload: { email: 'galardo@example.com', planName: 'KIRO FREE' },
        updatedCredential: undefined,
        error: undefined,
      }),
    )
    await svc.refreshQuota(account.id)
    const saved = await repo.findById(account.id)
    expect(saved!.displayIdentifier).toBe('galardo@example.com')
    expect(saved!.email).toBe('galardo@example.com')
    expect(saved!.identityKey).toBe(keyBefore) // 唯一键冻结
  })

  it('does not heal a non-kiro account even if the payload carries an email', async () => {
    const account = Account.create('cursor', 'opaque-id-xyz', undefined, [], undefined)
    const repo = new FakeAccountRepo([account])
    const svc = new QuotaApplicationService(
      repo,
      new FakeCredentialStore(new Credential('tok')),
      new FakeQuotaCache(),
      new FakeQuotaStateCache(),
      new StaticFetcher({
        ...cursorPayloadResult(),
        providerPayload: {
          email: 'someone@example.com',
          cursor_usage_raw: { individualUsage: { plan: { used: 1, limit: 9 } } },
        },
      }),
    )
    await svc.refreshQuota(account.id)
    const saved = await repo.findById(account.id)
    expect(saved!.displayIdentifier).toBe('opaque-id-xyz') // 非 kiro 不自愈
  })

  it('records failure state + account profile error on fetch failure', async () => {
    const account = makeAccount()
    const repo = new FakeAccountRepo([account])
    const stateCache = new FakeQuotaStateCache()
    const svc = new QuotaApplicationService(
      repo,
      new FakeCredentialStore(new Credential('tok')),
      new FakeQuotaCache(),
      stateCache,
      new FailingFetcher('network down'),
    )
    await expect(svc.refreshQuota(account.id)).rejects.toThrow('network down')
    expect(stateCache.state!.status).toBe('error')
    expect(stateCache.state!.error).toBe('network down')
    const saved = await repo.findById(account.id)
    expect((saved!.profilePayload as any).quotaQueryLastError).toBe('network down')
    expect(typeof (saved!.profilePayload as any).quotaQueryLastErrorAt).toBe('number')
  })

  it('succeeds even when the quota_state cache save fails', async () => {
    const account = makeAccount()
    const svc = new QuotaApplicationService(
      new FakeAccountRepo([account]),
      new FakeCredentialStore(new Credential('tok')),
      new FakeQuotaCache(),
      new FailingQuotaStateCache(),
      new StaticFetcher(legacyModelsResult()),
    )
    const quota = await svc.refreshQuota(account.id)
    expect(quota.models[0].modelName).toBe('gpt-4')
  })
})

describe('QuotaApplicationService.refreshQuotaState', () => {
  it('uses live provider payload for the normalised state', async () => {
    const account = makeAccount()
    const svc = new QuotaApplicationService(
      new FakeAccountRepo([account]),
      new FakeCredentialStore(new Credential('tok')),
      new FakeQuotaCache(),
      new FakeQuotaStateCache(),
      new StaticFetcher(cursorPayloadResult()),
    )
    const state = await svc.refreshQuotaState(account.id)
    expect(state.primaryMetricKey).toBe('total_usage')
    expect(state.metrics[0].used).toBe(20)
    expect(state.metrics[0].total).toBe(80)
  })
})

describe('QuotaApplicationService.getQuota / getQuotaState', () => {
  it('getQuota returns the cached value without a live fetch', async () => {
    const account = makeAccount()
    const cached = new QuotaInfo(account.id, [new ModelQuota('gpt-4', 10, 100)], new Date())
    const svc = new QuotaApplicationService(
      new FakeAccountRepo([account]),
      new FakeCredentialStore(new Credential('tok')),
      new FakeQuotaCache(cached),
      new FakeQuotaStateCache(),
      new FailingFetcher('live fetch should not be called'),
    )
    const quota = await svc.getQuota(account.id)
    expect(quota.accountId).toBe(account.id)
    expect(quota.models[0].modelName).toBe('gpt-4')
  })

  it('getQuotaState prefers the account profile parse over a live refresh', async () => {
    const account = Account.create('kiro', 'd-9067c98495.449', undefined, [], undefined)
    account.updateProfilePayload({ creditsTotal: 100, creditsUsed: 25, bonusTotal: 20, bonusUsed: 5 })
    const svc = new QuotaApplicationService(
      new FakeAccountRepo([account]),
      new FakeCredentialStore(new Credential('tok')),
      new FakeQuotaCache(),
      new FakeQuotaStateCache(),
      new FailingFetcher('live fetch should not be called'),
    )
    const state = await svc.getQuotaState(account.id)
    expect(state.primaryMetricKey).toBe('credits')
    expect(state.metrics[0].used).toBe(25)
    expect(state.metrics[0].total).toBe(100)
  })

  it('getQuotaState ignores legacy codex api_usage cache and reparses profile', async () => {
    const account = Account.create('codex', 'codex-account', undefined, [], undefined)
    account.updateProfilePayload({
      quota: {
        hourly_percentage: 35,
        hourly_reset_time: 1779888000,
        hourly_window_minutes: 300,
        hourly_window_present: true,
        weekly_percentage: 80,
        weekly_reset_time: 1780406400,
        weekly_window_minutes: 10080,
        weekly_window_present: true,
      },
    })
    const legacyState = {
      version: 1,
      status: 'ok' as const,
      primaryMetricKey: 'api_usage',
      metrics: [
        {
          key: 'api_usage',
          label: 'API Usage',
          kind: 'usage' as const,
          unit: 'usd' as const,
          used: 3.2,
          total: 20,
          remaining: 16.8,
          percentUsed: 16,
          percentRemaining: 84,
          displayValue: '3.20 / 20',
          window: undefined,
          resetAt: undefined,
          status: 'ok' as const,
        },
      ],
      fetchedAt: new Date(),
      error: undefined,
      providerPayload: {},
    }
    const { AccountQuotaState } = await import(
      '../../../src/main/contexts/quota/domain/quota-state'
    )
    const stateCache = new FakeQuotaStateCache(new AccountQuotaState(legacyState))
    const svc = new QuotaApplicationService(
      new FakeAccountRepo([account]),
      new FakeCredentialStore(new Credential('tok')),
      new FakeQuotaCache(),
      stateCache,
      new FailingFetcher('live fetch should not be called'),
    )
    const state = await svc.getQuotaState(account.id)
    expect(state.primaryMetricKey).toBe('codex_hourly')
    expect(state.metrics[0].label).toBe('5小时额度')
    expect(state.metrics[1].label).toBe('周额度')
  })
})

describe('QuotaApplicationService.refreshAll', () => {
  it('returns an empty array when there are no accounts', async () => {
    const svc = new QuotaApplicationService(
      new FakeAccountRepo([]),
      new FakeCredentialStore(null),
      new FakeQuotaCache(),
      new FakeQuotaStateCache(),
      new StaticFetcher(legacyModelsResult()),
    )
    const results = await svc.refreshAll()
    expect(results).toEqual([])
  })

  it('isolates per-account failures', async () => {
    const account = makeAccount('cursor')
    const svc = new QuotaApplicationService(
      new FakeAccountRepo([account]),
      new FakeCredentialStore(new Credential('tok')),
      new FakeQuotaCache(),
      new FakeQuotaStateCache(),
      new FailingFetcher('boom'),
      ['cursor'],
    )
    const results = await svc.refreshAll()
    expect(results.length).toBe(1)
    expect(results[0].success).toBe(false)
    expect(results[0].error).toContain('boom')
  })

  it('limits concurrent account refreshes', async () => {
    const accounts = Array.from({ length: 8 }, () => makeAccount('cursor'))
    const fetcher = new SlowTrackingFetcher()
    const svc = new QuotaApplicationService(
      new FakeAccountRepo(accounts),
      new FakeCredentialStore(new Credential('tok')),
      new FakeQuotaCache(),
      new FakeQuotaStateCache(),
      fetcher,
      ['cursor'],
    )
    const results = await svc.refreshAll()
    expect(results).toHaveLength(8)
    expect(results.every((result) => result.success)).toBe(true)
    expect(fetcher.maxActive).toBeLessThanOrEqual(4)
  })
})

describe('QuotaApplicationService.refreshQuota — 代理错误处理', () => {
  const SOCKS_ERR = 'fetch failed [cause: SocksClient internal error (this should not happen)]'

  it('走代理时 SOCKS 报错 → 驱逐缓存 dispatcher + 改写为可读消息', async () => {
    const account = makeAccount('kiro')
    const evicted: string[] = []
    const resolver = {
      dispatcherForAccount: async () => ({}) as unknown as import('undici').Dispatcher,
      evictDispatcherForAccount: async (id: string) => {
        evicted.push(id)
      },
    }
    const svc = new QuotaApplicationService(
      new FakeAccountRepo([account]),
      new FakeCredentialStore(new Credential('tok')),
      new FakeQuotaCache(),
      new FakeQuotaStateCache(),
      new FailingFetcher(SOCKS_ERR),
      undefined,
      resolver,
    )
    await expect(svc.refreshQuota(account.id)).rejects.toThrow(/通过代理连接失败/)
    expect(evicted).toEqual([account.id])
  })

  it('未走代理（直连）时同样的报错 → 原样抛出、不驱逐', async () => {
    const account = makeAccount('cursor')
    const evicted: string[] = []
    const resolver = {
      dispatcherForAccount: async () => undefined,
      evictDispatcherForAccount: async (id: string) => {
        evicted.push(id)
      },
    }
    const svc = new QuotaApplicationService(
      new FakeAccountRepo([account]),
      new FakeCredentialStore(new Credential('tok')),
      new FakeQuotaCache(),
      new FakeQuotaStateCache(),
      new FailingFetcher(SOCKS_ERR),
      undefined,
      resolver,
    )
    await expect(svc.refreshQuota(account.id)).rejects.toThrow(/SocksClient internal error/)
    expect(evicted).toEqual([])
  })
})
