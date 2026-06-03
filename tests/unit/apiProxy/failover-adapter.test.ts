// tests/unit/apiProxy/failover-adapter.test.ts
import { describe, it, expect, vi } from 'vitest'
import { FailoverAdapter, NoHealthyAccountError } from '../../../src/main/contexts/apiProxy/domain/account-selection/failover-adapter'
import type { CanonicalStreamEvent } from '../../../src/main/contexts/apiProxy/domain/canonical'
import { AccountPoolSelector } from '../../../src/main/contexts/apiProxy/domain/account-selection/account-pool-selector'
import { AccountHealthTracker } from '../../../src/main/contexts/apiProxy/domain/account-selection/account-health-tracker'
import { KiroUpstreamSuspendedError } from '../../../src/main/contexts/apiProxy/infrastructure/adapters/kiro/kiro-error'
import type { CanonicalRequest, CanonicalResponse } from '../../../src/main/contexts/apiProxy/domain/canonical'

const ir: CanonicalRequest = { model: 'claude-sonnet-4.5', system: '', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] }
const okResp: CanonicalResponse = { model: 'claude-sonnet-4.5', content: [{ type: 'text', text: 'ok' }], stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 } }

function deps(
  rows: any[],
  innerChat: (ctx: any) => Promise<CanonicalResponse>,
  opts: { suspendedSink?: string[]; sleep?: (ms: number) => Promise<void>; retryDelayMs?: number } = {},
) {
  const now = { t: 0 }
  const health = new AccountHealthTracker({ baseCooldownMs: 1000, maxBackoffMultiplier: 64, quotaResetMs: 3600000, probabilisticRetryChance: 0, clock: () => now.t, random: () => 1 })
  const selector = new AccountPoolSelector({ strategy: 'sticky-lru', perAccountConcurrency: 4, affinityTtlMs: 1000, clock: () => now.t }, health)
  const suspendedSink = opts.suspendedSink ?? []
  const inner = {
    platform: 'kiro', supportsModel: () => true, listModels: () => [],
    classifyError: (e: any) => (e?.name === 'KiroUpstreamSuspendedError' ? 'SUSPENDED' : 'SERVER'),
    chat: (_ir: any, ctx: any) => innerChat(ctx),
    chatStream: () => { throw new Error('n/a') },
  }
  const accounts = {
    async listByPlatform() { return rows },
    async markSuspended(id: string) { suspendedSink.push(id) },
    async clearSuspension() {},
  }
  return new FailoverAdapter({
    inner: inner as any, selector, health,
    accounts: accounts as any,
    credentials: { async retrieve(id: string) { return { token: `tk-${id}` } } } as any,
    dispatchers: { async dispatcherForAccount() { return undefined } } as any,
    maxRetries: 3,
    retryDelayMs: opts.retryDelayMs ?? 100,
    sleep: opts.sleep ?? (() => Promise.resolve()),
  })
}

it('首个账号成功直接返回', async () => {
  const fa = deps([{ id: 'a', isActive: true }], async () => okResp)
  expect((await fa.chat(ir, { requestId: 'r' })).content[0]).toMatchObject({ text: 'ok' })
})

it('suspended → 持久化退役 + 切到下一账号', async () => {
  const sink: string[] = []
  let n = 0
  const fa = deps(
    [{ id: 'a', isActive: true, lastUsedAt: 1 }, { id: 'b', isActive: true, lastUsedAt: 2 }],
    async (ctx) => { n++; if (ctx.account.id === 'a') throw new KiroUpstreamSuspendedError('x', 403); return okResp },
    { suspendedSink: sink },
  )
  const resp = await fa.chat(ir, { requestId: 'r' })
  expect(resp.content[0]).toMatchObject({ text: 'ok' })
  expect(sink).toContain('a')   // a 被持久化退役
  expect(n).toBe(2)             // 试了 a 再切 b
})

it('已 SUSPENDED 状态的账号不进候选', async () => {
  const fa = deps([{ id: 'a', isActive: true, status: 'SUSPENDED' }, { id: 'b', isActive: true }], async () => okResp)
  const resp = await fa.chat(ir, { requestId: 'r' })
  expect(resp.content[0]).toMatchObject({ text: 'ok' }) // 直接用 b
})

it('全部账号失败 → 抛最后错误（或 NoHealthy）', async () => {
  const fa = deps([{ id: 'a', isActive: true }], async () => { throw new KiroUpstreamSuspendedError('x', 403) })
  await expect(fa.chat(ir, { requestId: 'r' })).rejects.toBeTruthy()
})

it('无候选 → NoHealthyAccountError', async () => {
  const fa = deps([], async () => okResp)
  await expect(fa.chat(ir, { requestId: 'r' })).rejects.toBeInstanceOf(NoHealthyAccountError)
})

describe('retryDelayMs / sleep', () => {
  it('SERVER 错误时 sleep 被调用一次（retryDelayMs）', async () => {
    const sleepCalls: number[] = []
    const sleep = vi.fn((ms: number) => { sleepCalls.push(ms); return Promise.resolve() })
    // 第一次 SERVER 失败，第二次成功
    let n = 0
    const fa = deps(
      [{ id: 'a', isActive: true }, { id: 'b', isActive: true }],
      async (ctx) => { n++; if (n === 1) throw new Error('server err'); return okResp },
      { sleep, retryDelayMs: 42 },
    )
    await fa.chat(ir, { requestId: 'r' })
    expect(sleep).toHaveBeenCalledTimes(1)
    expect(sleepCalls[0]).toBe(42)
  })

  it('非 SERVER 错误（SUSPENDED）不触发 sleep', async () => {
    const sleep = vi.fn(() => Promise.resolve())
    const fa = deps(
      [{ id: 'a', isActive: true }, { id: 'b', isActive: true }],
      async (ctx) => {
        if (ctx.account.id === 'a') throw new KiroUpstreamSuspendedError('x', 403)
        return okResp
      },
      { sleep, retryDelayMs: 42 },
    )
    await fa.chat(ir, { requestId: 'r' })
    expect(sleep).not.toHaveBeenCalled()
  })
})

// ══════════════════════════════════════════════════════════
// 回收回归：chatStream 客户端提前断连时 inner generator 被转发 return()
// ══════════════════════════════════════════════════════════
describe('chatStream 资源回收回归', () => {
  /**
   * 构造支持 chatStream mock 的 deps。
   * innerStreamGen: 给 inner.chatStream 的实现（返回 AsyncIterable）。
   */
  function streamDeps(
    rows: any[],
    innerStreamGen: (ir: any, ctx: any) => AsyncIterable<CanonicalStreamEvent>,
    opts: { sleep?: (ms: number) => Promise<void> } = {},
  ) {
    const now = { t: 0 }
    const health = new AccountHealthTracker({ baseCooldownMs: 1000, maxBackoffMultiplier: 64, quotaResetMs: 3600000, probabilisticRetryChance: 0, clock: () => now.t, random: () => 1 })
    const selector = new AccountPoolSelector({ strategy: 'sticky-lru', perAccountConcurrency: 4, affinityTtlMs: 1000, clock: () => now.t }, health)
    const inner = {
      platform: 'kiro', supportsModel: () => true, listModels: () => [],
      classifyError: (_e: any) => 'SERVER' as const,
      chat: async () => okResp,
      chatStream: innerStreamGen,
    }
    const accounts = {
      async listByPlatform() { return rows },
      async markSuspended() {},
      async clearSuspension() {},
    }
    return new FailoverAdapter({
      inner: inner as any, selector, health,
      accounts: accounts as any,
      credentials: { async retrieve(id: string) { return { token: `tk-${id}` } } } as any,
      dispatchers: { async dispatcherForAccount() { return undefined } } as any,
      maxRetries: 3,
      retryDelayMs: 0,
      sleep: opts.sleep ?? (() => Promise.resolve()),
    })
  }

  it('客户端取 1 帧后 it.return() → inner generator finally 执行（上游 reader 被回收）', async () => {
    let innerReturned = false

    const fa = streamDeps([{ id: 'a', isActive: true }], async function* () {
      try {
        yield { type: 'text_delta', text: 'frame1' } as CanonicalStreamEvent
        yield { type: 'text_delta', text: 'frame2' } as CanonicalStreamEvent
        yield { type: 'message_stop', stopReason: 'end_turn' } as CanonicalStreamEvent
      } finally {
        innerReturned = true
      }
    })

    const it = fa.chatStream(ir, { requestId: 'r' })[Symbol.asyncIterator]()
    // 取首帧
    const first = await it.next()
    expect(first.done).toBe(false)
    expect((first.value as { text: string }).text).toBe('frame1')

    // 客户端主动断连
    await it.return!()

    // inner generator 的 finally 必须已被执行（return() 被转发）
    expect(innerReturned).toBe(true)
  })

  it('客户端取 1 帧后 it.return() → lease.release 被调用', async () => {
    // spy AccountPoolSelector.acquire，拿到 lease 对象后再 spy release
    const now = { t: 0 }
    const health = new AccountHealthTracker({ baseCooldownMs: 1000, maxBackoffMultiplier: 64, quotaResetMs: 3600000, probabilisticRetryChance: 0, clock: () => now.t, random: () => 1 })
    const selector = new AccountPoolSelector({ strategy: 'sticky-lru', perAccountConcurrency: 4, affinityTtlMs: 1000, clock: () => now.t }, health)

    // spy acquire 以捕获 lease
    let capturedRelease: (() => void) | undefined
    const origAcquire = selector.acquire.bind(selector)
    const acquireSpy = vi.spyOn(selector, 'acquire').mockImplementation((...args) => {
      const lease = origAcquire(...args)
      if (lease !== null) {
        const origRelease = lease.release.bind(lease)
        capturedRelease = vi.fn(origRelease) as () => void
        ;(lease as any).release = capturedRelease
      }
      return lease
    })

    const inner = {
      platform: 'kiro', supportsModel: () => true, listModels: () => [],
      classifyError: (_e: any) => 'SERVER' as const,
      chat: async () => okResp,
      chatStream: async function* () {
        yield { type: 'text_delta', text: 'frame1' } as CanonicalStreamEvent
        yield { type: 'text_delta', text: 'frame2' } as CanonicalStreamEvent
      },
    }
    const accounts = {
      async listByPlatform() { return [{ id: 'a', isActive: true }] },
      async markSuspended() {},
      async clearSuspension() {},
    }
    const fa = new FailoverAdapter({
      inner: inner as any, selector, health,
      accounts: accounts as any,
      credentials: { async retrieve(id: string) { return { token: `tk-${id}` } } } as any,
      dispatchers: { async dispatcherForAccount() { return undefined } } as any,
      maxRetries: 3, retryDelayMs: 0,
    })

    const it = fa.chatStream(ir, { requestId: 'r' })[Symbol.asyncIterator]()
    await it.next()   // 取首帧（触发 acquire + started=true）
    await it.return!()

    // lease.release 必须已被调用（finally 分支执行）
    expect(capturedRelease).toBeDefined()
    expect(capturedRelease!).toHaveBeenCalled()

    acquireSpy.mockRestore()
  })
})
