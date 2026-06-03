// tests/unit/apiProxy/m4-integration.test.ts
import { describe, it, expect } from 'vitest'
import { ApiProxyService } from '../../../src/main/contexts/apiProxy/application/api-proxy-service'
import { FailoverAdapter } from '../../../src/main/contexts/apiProxy/domain/account-selection/failover-adapter'
import { AccountPoolSelector } from '../../../src/main/contexts/apiProxy/domain/account-selection/account-pool-selector'
import { AccountHealthTracker } from '../../../src/main/contexts/apiProxy/domain/account-selection/account-health-tracker'
import { KiroUpstreamSuspendedError } from '../../../src/main/contexts/apiProxy/infrastructure/adapters/kiro/kiro-error'

// PlatformRegistry stub：selectAdapter 直接返回我们的 FailoverAdapter
function regWith(adapter: any) {
  return { selectAdapter: () => adapter, listAllModels: () => [{ id: 'claude-sonnet-4.5' }] } as any
}
const okResp = { model: 'claude-sonnet-4.5', content: [{ type: 'text', text: 'ok' }], stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 } }

function buildFailover(rows: any[], chat: (ctx: any) => Promise<any>, sink: string[] = []) {
  const now = { t: 0 }
  const health = new AccountHealthTracker({ baseCooldownMs: 1000, maxBackoffMultiplier: 64, quotaResetMs: 3600000, probabilisticRetryChance: 0, clock: () => now.t, random: () => 1 })
  const selector = new AccountPoolSelector({ strategy: 'sticky-lru', perAccountConcurrency: 4, affinityTtlMs: 1000, clock: () => now.t }, health)
  const inner = { platform: 'kiro', supportsModel: () => true, listModels: () => [], classifyError: (e: any) => (e?.name === 'KiroUpstreamSuspendedError' ? 'SUSPENDED' : 'SERVER'), chat: (_i: any, ctx: any) => chat(ctx), chatStream: () => { throw new Error('na') } }
  return new FailoverAdapter({
    inner: inner as any, selector, health,
    accounts: { async listByPlatform() { return rows }, async markSuspended(id: string) { sink.push(id) }, async clearSuspension() {} } as any,
    credentials: { async retrieve(id: string) { return { token: `tk-${id}` } } } as any,
    dispatchers: { async dispatcherForAccount() { return undefined } } as any,
    maxRetries: 3,
  })
}

const openaiBody = { model: 'claude-sonnet-4.5', messages: [{ role: 'user', content: 'hi' }] }
const intent = { format: 'openai', action: 'chat', stream: false, platform: 'kiro', model: 'claude-sonnet-4.5' } as any

it('suspended 账号自动切号，请求成功', async () => {
  const sink: string[] = []
  const fa = buildFailover(
    [{ id: 'a', isActive: true, lastUsedAt: 1 }, { id: 'b', isActive: true, lastUsedAt: 2 }],
    async (ctx) => { if (ctx.account.id === 'a') throw new KiroUpstreamSuspendedError('x', 403); return okResp },
    sink,
  )
  const svc = new ApiProxyService(undefined, { registry: regWith(fa) })
  const res = await svc.handleRequest({ intent, body: openaiBody, requestId: 'r', headers: {} })
  expect(res.kind).toBe('json')
  expect(sink).toContain('a')
})

it('全账号 suspended → 403', async () => {
  const fa = buildFailover([{ id: 'a', isActive: true }], async () => { throw new KiroUpstreamSuspendedError('x', 403) })
  const svc = new ApiProxyService(undefined, { registry: regWith(fa) })
  await expect(svc.handleRequest({ intent, body: openaiBody, requestId: 'r', headers: {} }))
    .rejects.toMatchObject({ status: 403 })
})

it('会话粘性：同 hint 两次命中同一账号', async () => {
  const seen: string[] = []
  const fa = buildFailover(
    [{ id: 'a', isActive: true, lastUsedAt: 1 }, { id: 'b', isActive: true, lastUsedAt: 2 }],
    async (ctx) => { seen.push(ctx.account.id); return okResp },
  )
  const svc = new ApiProxyService(undefined, { registry: regWith(fa) })
  const headers = { 'x-conversation-id': 'conv-1' }
  await svc.handleRequest({ intent, body: openaiBody, requestId: 'r1', headers })
  await svc.handleRequest({ intent, body: openaiBody, requestId: 'r2', headers })
  expect(seen[0]).toBe(seen[1]) // 粘性命中同一账号
})
