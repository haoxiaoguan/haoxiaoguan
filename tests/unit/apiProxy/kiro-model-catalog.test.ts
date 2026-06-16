// KiroModelCatalog 单测：严格门控 / 会员最高选号 / 纯替代+空回退 / 快照与手动刷新。
import { describe, it, expect } from 'vitest'
import { KiroModelCatalog } from '../../../src/main/contexts/apiProxy/infrastructure/adapters/kiro/kiro-model-catalog'
import { AccountHealthTracker } from '../../../src/main/contexts/apiProxy/domain/account-selection/account-health-tracker'
import type { FetchImpl } from '../../../src/main/platform/net/kiro/kiro-identity-client'
import type {
  KiroAccountInfo,
  KiroAccountPort,
  KiroCredential,
  KiroCredentialPort,
} from '../../../src/main/contexts/apiProxy/infrastructure/adapters/kiro/kiro-ports'
import type { ModelInfo } from '../../../src/main/contexts/apiProxy/domain/platform-adapter'

// 确定性健康追踪：probabilisticRetryChance=0 → 冷却账号绝不放行；clock 固定。
function makeHealth(): AccountHealthTracker {
  return new AccountHealthTracker({
    baseCooldownMs: 1000,
    maxBackoffMultiplier: 10,
    quotaResetMs: 1000,
    probabilisticRetryChance: 0,
    clock: () => 0,
    random: () => 0.99,
  })
}

function accountsPort(list: KiroAccountInfo[]): KiroAccountPort {
  return {
    listByPlatform: async () => list,
    markSuspended: async () => {},
    clearSuspension: async () => {},
  }
}

function credsPort(map: Record<string, KiroCredential>): KiroCredentialPort {
  return { retrieve: async (id) => map[id] ?? null }
}

// 假 fetch：捕获调用，按页返回 models。
function fakeFetch(pages: Array<{ status: number; body: unknown }>): {
  impl: FetchImpl
  calls: Array<{ url: string }>
} {
  const calls: Array<{ url: string }> = []
  let idx = 0
  const impl: FetchImpl = async (url: string): Promise<Response> => {
    calls.push({ url })
    const page = pages[idx] ?? pages[pages.length - 1]
    idx++
    const text = typeof page.body === 'string' ? page.body : JSON.stringify(page.body)
    return { ok: page.status >= 200 && page.status < 300, status: page.status, text: async () => text } as Response
  }
  return { impl, calls }
}

const FALLBACK: ModelInfo[] = [
  { id: 'claude-opus-4.8', displayName: 'claude-opus-4.8', ownedBy: 'anthropic', supportsThinking: true },
  { id: 'claude-sonnet-4.5', displayName: 'claude-sonnet-4.5', ownedBy: 'anthropic', supportsThinking: true },
]

function acct(p: Partial<KiroAccountInfo> & { id: string }): KiroAccountInfo {
  return { email: `${p.id}@e`, isActive: true, ...p }
}

describe('KiroModelCatalog', () => {
  it('无账号 → 严格门控返回 []', async () => {
    const cat = new KiroModelCatalog({
      accounts: accountsPort([]),
      health: makeHealth(),
      credentials: credsPort({}),
      isPooled: () => true,
      fallbackModels: () => FALLBACK,
      fetchImpl: fakeFetch([{ status: 200, body: { models: [] } }]).impl,
    })
    await cat.warm()
    expect(cat.listForServe()).toEqual([])
  })

  it('健康账号 + 上游返回模型 → 纯替代（live 覆盖硬编码）', async () => {
    const f = fakeFetch([
      { status: 200, body: { models: [{ modelId: 'claude-sonnet-4.5', modelName: 'Sonnet 4.5', tokenLimits: { maxInputTokens: 200000, maxOutputTokens: 64000 }, promptCaching: { supportsPromptCaching: true } }] } },
    ])
    const cat = new KiroModelCatalog({
      accounts: accountsPort([acct({ id: 'a' })]),
      health: makeHealth(),
      credentials: credsPort({ a: { token: 'tokA', rawMetadata: { region: 'us-east-1', profileArn: 'arn:a', machineId: 'm' } } }),
      isPooled: () => true,
      fallbackModels: () => FALLBACK,
      fetchImpl: f.impl,
    })
    await cat.warm()
    const out = cat.listForServe()
    expect(out.map((m) => m.id)).toEqual(['claude-sonnet-4.5'])
    expect(out[0].contextLength).toBe(200000)
    expect(out[0].maxOutputTokens).toBe(64000)
    expect(out[0].supportsPromptCaching).toBe(true)
    expect(out[0].ownedBy).toBe('anthropic')
  })

  it('canServe 收口：过滤掉 adapter 不可路由的模型（auto/deepseek 等），只留 claude', async () => {
    const f = fakeFetch([
      { status: 200, body: { models: [
        { modelId: 'claude-sonnet-4.5' },
        { modelId: 'deepseek-3.2' },
        { modelId: 'auto' },
        { modelId: 'claude-opus-4.8' },
      ] } },
    ])
    const cat = new KiroModelCatalog({
      accounts: accountsPort([acct({ id: 'a' })]),
      health: makeHealth(),
      credentials: credsPort({ a: { token: 'tokA', rawMetadata: { region: 'us-east-1', profileArn: 'arn:a', machineId: 'm' } } }),
      isPooled: () => true,
      fallbackModels: () => FALLBACK,
      canServe: (id) => /^claude-/.test(id),
      fetchImpl: f.impl,
    })
    await cat.warm()
    expect(cat.listForServe().map((m) => m.id)).toEqual(['claude-sonnet-4.5', 'claude-opus-4.8'])
  })

  it('canServe 过滤后全空（live 全不可路由）→ 回退硬编码', async () => {
    const f = fakeFetch([{ status: 200, body: { models: [{ modelId: 'deepseek-3.2' }, { modelId: 'auto' }] } }])
    const cat = new KiroModelCatalog({
      accounts: accountsPort([acct({ id: 'a' })]),
      health: makeHealth(),
      credentials: credsPort({ a: { token: 'tokA', rawMetadata: { region: 'us-east-1', profileArn: 'arn:a', machineId: 'm' } } }),
      isPooled: () => true,
      fallbackModels: () => FALLBACK,
      canServe: (id) => /^claude-/.test(id),
      fetchImpl: f.impl,
    })
    await cat.warm()
    expect(cat.listForServe().map((m) => m.id)).toEqual(['claude-opus-4.8', 'claude-sonnet-4.5'])
  })

  it('上游返回空 → 回退硬编码', async () => {
    const cat = new KiroModelCatalog({
      accounts: accountsPort([acct({ id: 'a' })]),
      health: makeHealth(),
      credentials: credsPort({ a: { token: 'tokA', rawMetadata: { region: 'us-east-1', profileArn: 'arn:a', machineId: 'm' } } }),
      isPooled: () => true,
      fallbackModels: () => FALLBACK,
      fetchImpl: fakeFetch([{ status: 200, body: { models: [] } }]).impl,
    })
    await cat.warm()
    expect(cat.listForServe().map((m) => m.id)).toEqual(['claude-opus-4.8', 'claude-sonnet-4.5'])
  })

  it('凭据缺失 → 回退硬编码', async () => {
    const cat = new KiroModelCatalog({
      accounts: accountsPort([acct({ id: 'a' })]),
      health: makeHealth(),
      credentials: credsPort({}),
      isPooled: () => true,
      fallbackModels: () => FALLBACK,
      fetchImpl: fakeFetch([{ status: 200, body: { models: [{ modelId: 'x' }] } }]).impl,
    })
    await cat.warm()
    expect(cat.listForServe().map((m) => m.id)).toEqual(['claude-opus-4.8', 'claude-sonnet-4.5'])
  })

  it('账号非池内 → 门控返回 []', async () => {
    const cat = new KiroModelCatalog({
      accounts: accountsPort([acct({ id: 'a' })]),
      health: makeHealth(),
      credentials: credsPort({ a: { token: 't', rawMetadata: {} } }),
      isPooled: () => false,
      fallbackModels: () => FALLBACK,
      fetchImpl: fakeFetch([{ status: 200, body: { models: [{ modelId: 'x' }] } }]).impl,
    })
    await cat.warm()
    expect(cat.listForServe()).toEqual([])
  })

  it('账号挂起（health suspended）→ 门控返回 []', async () => {
    const health = makeHealth()
    health.markSuspended('a')
    const cat = new KiroModelCatalog({
      accounts: accountsPort([acct({ id: 'a' })]),
      health,
      credentials: credsPort({ a: { token: 't', rawMetadata: {} } }),
      isPooled: () => true,
      fallbackModels: () => FALLBACK,
      fetchImpl: fakeFetch([{ status: 200, body: { models: [{ modelId: 'x' }] } }]).impl,
    })
    await cat.warm()
    expect(cat.listForServe()).toEqual([])
  })

  it('账号 inactive 但已入池 → 仍可用（目录不要求 is_active）', async () => {
    // is_active 是 CLI 切换标志，与反代池无关；池成员通常都是 inactive。
    const cat = new KiroModelCatalog({
      accounts: accountsPort([acct({ id: 'a', isActive: false })]),
      health: makeHealth(),
      credentials: credsPort({ a: { token: 't', rawMetadata: { region: 'us-east-1', profileArn: 'arn:a', machineId: 'm' } } }),
      isPooled: () => true,
      fallbackModels: () => FALLBACK,
      fetchImpl: fakeFetch([{ status: 200, body: { models: [{ modelId: 'live-model' }] } }]).impl,
    })
    await cat.warm()
    expect(cat.listForServe().map((m) => m.id)).toEqual(['live-model'])
  })

  it('多账号 → 取会员档位最高者的清单（profileArn 体现在上游请求）', async () => {
    const f = fakeFetch([{ status: 200, body: { models: [{ modelId: 'pro-model' }] } }])
    const cat = new KiroModelCatalog({
      accounts: accountsPort([
        acct({ id: 'free', planName: 'Free' }),
        acct({ id: 'pro', planName: 'KIRO PRO+' }),
      ]),
      health: makeHealth(),
      credentials: credsPort({
        free: { token: 'tFree', rawMetadata: { region: 'us-east-1', profileArn: 'arn:free', machineId: 'm' } },
        pro: { token: 'tPro', rawMetadata: { region: 'us-east-1', profileArn: 'arn:pro', machineId: 'm' } },
      }),
      isPooled: () => true,
      fallbackModels: () => FALLBACK,
      fetchImpl: f.impl,
    })
    await cat.warm()
    expect(cat.listForServe().map((m) => m.id)).toEqual(['pro-model'])
    // 选了 pro 账号 → 上游 URL 带其 profileArn（encodeURIComponent('arn:pro')）。
    expect(f.calls.some((c) => c.url.includes('arn%3Apro'))).toBe(true)
    expect(f.calls.some((c) => c.url.includes('arn%3Afree'))).toBe(false)
  })

  it('快照黏滞：warm(false) 不重复拉取；refresh() 强制重建', async () => {
    let page = 0
    const calls: string[] = []
    const impl: FetchImpl = async (url: string): Promise<Response> => {
      calls.push(url)
      const models = page === 0 ? [{ modelId: 'v1' }] : [{ modelId: 'v2' }]
      page++
      return { ok: true, status: 200, text: async () => JSON.stringify({ models }) } as Response
    }
    const cat = new KiroModelCatalog({
      accounts: accountsPort([acct({ id: 'a' })]),
      health: makeHealth(),
      credentials: credsPort({ a: { token: 't', rawMetadata: { region: 'us-east-1', profileArn: 'arn:a', machineId: 'm' } } }),
      isPooled: () => true,
      fallbackModels: () => FALLBACK,
      fetchImpl: impl,
    })
    await cat.warm()
    expect(cat.listForServe().map((m) => m.id)).toEqual(['v1'])
    const callsAfterWarm = calls.length
    await cat.warm(false) // 快照已存在 → 不重复拉取
    expect(calls.length).toBe(callsAfterWarm)
    expect(cat.listForServe().map((m) => m.id)).toEqual(['v1'])
    await cat.refresh() // 手动刷新 → 强制重建
    expect(calls.length).toBe(callsAfterWarm + 1)
    expect(cat.listForServe().map((m) => m.id)).toEqual(['v2'])
  })
})
