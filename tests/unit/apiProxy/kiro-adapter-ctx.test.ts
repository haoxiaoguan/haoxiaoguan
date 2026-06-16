import { describe, it, expect } from 'vitest'
import { KiroAdapter } from '../../../src/main/contexts/apiProxy/infrastructure/adapters/kiro/kiro-adapter'
import { KiroUpstreamClient } from '../../../src/main/contexts/apiProxy/infrastructure/adapters/kiro/kiro-upstream-client'
import { KiroUpstreamSuspendedError } from '../../../src/main/contexts/apiProxy/infrastructure/adapters/kiro/kiro-error'
import { currentDispatcher } from '../../../src/main/platform/net/dispatcher-context'
import type { CanonicalRequest, CanonicalStreamEvent } from '../../../src/main/contexts/apiProxy/domain/canonical'
import type { Dispatcher } from 'undici'

const ir: CanonicalRequest = { model: 'claude-sonnet-4.5', system: '', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] }
const account = { id: 'acc-1', email: 'a@x', isActive: true }
const credential = { token: 'TKN-1' }
const cacheStub = { buildProfile: () => null, compute: () => ({ cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }), update: () => {} } as any

describe('KiroAdapter resolveMachineId — per-account 隔离（P1-3）', () => {
  it('不同 account.id → callCtx.machineId 不同', async () => {
    const capturedMachineIds: string[] = []
    const client = {
      async chat(_e: any, ctx: any) {
        capturedMachineIds.push(ctx.machineId)
        return { model: 'claude-sonnet-4.5', content: [{ type: 'text', text: 'ok' }], stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 } }
      },
    } as unknown as KiroUpstreamClient
    const adapter = new KiroAdapter({ client, cacheTracker: { buildProfile: () => null, compute: () => ({ cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }), update: () => {} } as any })

    await adapter.chat(ir, { requestId: 'r1', account: { id: 'account-AAA', email: 'a@x', isActive: true }, credential: { token: 'T' } })
    await adapter.chat(ir, { requestId: 'r2', account: { id: 'account-BBB', email: 'b@x', isActive: true }, credential: { token: 'T' } })

    expect(capturedMachineIds).toHaveLength(2)
    expect(capturedMachineIds[0]).toMatch(/^[0-9a-f]{64}$/)
    expect(capturedMachineIds[1]).toMatch(/^[0-9a-f]{64}$/)
    expect(capturedMachineIds[0]).not.toBe(capturedMachineIds[1])
  })

  it('相同 account.id → callCtx.machineId 稳定（重复调用一致）', async () => {
    const capturedMachineIds: string[] = []
    const client = {
      async chat(_e: any, ctx: any) {
        capturedMachineIds.push(ctx.machineId)
        return { model: 'claude-sonnet-4.5', content: [{ type: 'text', text: 'ok' }], stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 } }
      },
    } as unknown as KiroUpstreamClient
    const adapter = new KiroAdapter({ client, cacheTracker: { buildProfile: () => null, compute: () => ({ cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }), update: () => {} } as any })
    const sameAccount = { id: 'account-SAME', email: 'c@x', isActive: true }

    await adapter.chat(ir, { requestId: 'r1', account: sameAccount, credential: { token: 'T' } })
    await adapter.chat(ir, { requestId: 'r2', account: sameAccount, credential: { token: 'T' } })

    expect(capturedMachineIds[0]).toBe(capturedMachineIds[1])
  })

  it('显式 machineId（cred.rawMetadata）优先级不变', async () => {
    let seenMachineId = ''
    const client = {
      async chat(_e: any, ctx: any) {
        seenMachineId = ctx.machineId
        return { model: 'claude-sonnet-4.5', content: [{ type: 'text', text: 'ok' }], stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 } }
      },
    } as unknown as KiroUpstreamClient
    const adapter = new KiroAdapter({ client, cacheTracker: { buildProfile: () => null, compute: () => ({ cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }), update: () => {} } as any })

    await adapter.chat(ir, {
      requestId: 'r1',
      account: { id: 'account-ZZZ', email: 'z@x', isActive: true },
      credential: { token: 'T', rawMetadata: { machineId: 'explicit-machine-id-override-64chars0000000000000000000000000000' } },
    })
    expect(seenMachineId).toBe('explicit-machine-id-override-64chars0000000000000000000000000000')
  })
})

describe('KiroAdapter ctx 注入', () => {
  it('chat 用 ctx 注入的账号/凭据（不再自选号）', async () => {
    let seenToken = ''
    const client = { async chat(_e: any, ctx: any) { seenToken = ctx.accessToken; return { model: 'claude-sonnet-4.5', content: [{ type: 'text', text: 'ok' }], stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 } } } } as unknown as KiroUpstreamClient
    const adapter = new KiroAdapter({ client, cacheTracker: cacheStub })
    const resp = await adapter.chat(ir, { requestId: 'r1', account, credential })
    expect(seenToken).toBe('TKN-1')
    expect(resp.content[0]).toMatchObject({ type: 'text', text: 'ok' })
  })

  it('缺 ctx.account → NoKiroAccountError', async () => {
    const adapter = new KiroAdapter({ client: {} as any, cacheTracker: cacheStub })
    await expect(adapter.chat(ir, { requestId: 'r1' })).rejects.toThrow(/requires ctx\.account/)
  })

  it('classifyError 委托 classifyKiroError', () => {
    const adapter = new KiroAdapter({ client: {} as any, cacheTracker: cacheStub })
    expect(adapter.classifyError(new KiroUpstreamSuspendedError('x', 403))).toBe('SUSPENDED')
  })

  it('send() 对 403 suspended body 抛 KiroUpstreamSuspendedError（不浪费刷新）', async () => {
    let refreshCalls = 0
    const fetchImpl = async () => ({ ok: false, status: 403, text: async () => '{"reason":"TEMPORARILY_SUSPENDED"}', bytes: async () => new Uint8Array(), bytesStream: async function* () {} as any })
    const client = new KiroUpstreamClient({ fetchImpl: fetchImpl as any, refresher: { async refresh() { refreshCalls++; return { kind: 'permanent' as const } } } })
    const callCtx = { accessToken: 't', region: 'us-east-1', machineId: 'm', agentMode: 'spec' as const, invocationId: 'i' }
    await expect(client.chat({} as any, callCtx, 'claude-sonnet-4.5', ir)).rejects.toBeInstanceOf(KiroUpstreamSuspendedError)
    expect(refreshCalls).toBe(0) // suspended 不触发刷新
  })
})

describe('KiroAdapter.chatStream 增量迭代 + dispatcher context 边界', () => {
  it('openStream 在 dispatcher context 内被调用（fetch 发起绑定 dispatcher）', async () => {
    // mock dispatcher（undici Dispatcher 接口最小实现，仅用于 identity 断言）
    const fakeDispatcher = { dispatch: () => false } as unknown as Dispatcher

    let capturedDispatcher: Dispatcher | undefined = undefined

    // mock client：openStream 被调时捕获 currentDispatcher()（断言 fetch 发起在 context 内）
    const mockClient = {
      async openStream(_envelope: any, _ctx: any, _model: string, _req: any): Promise<AsyncIterable<CanonicalStreamEvent>> {
        // 此处必须在 runWithDispatcher 内调用，故 currentDispatcher() 应等于注入的 fakeDispatcher
        capturedDispatcher = currentDispatcher()

        async function* gen(): AsyncIterable<CanonicalStreamEvent> {
          yield { type: 'text_delta', text: 'hello' }
          yield { type: 'text_delta', text: ' world' }
          yield { type: 'usage', usage: { inputTokens: 5, outputTokens: 2 } }
          yield { type: 'message_stop', stopReason: 'end_turn' }
        }
        return gen()
      },
    } as unknown as KiroUpstreamClient

    const adapter = new KiroAdapter({ client: mockClient, cacheTracker: cacheStub })

    const out: CanonicalStreamEvent[] = []
    for await (const ev of adapter.chatStream(ir, { requestId: 'r1', account, credential, dispatcher: fakeDispatcher })) {
      out.push(ev)
    }

    // 断言：openStream 被调时 dispatcher context 已激活
    expect(capturedDispatcher).toBe(fakeDispatcher)
  })

  it('增量 yield 顺序正确，usage 经 applyCacheToUsage 处理', async () => {
    const mockClient = {
      async openStream(_envelope: any, _ctx: any, _model: string, _req: any): Promise<AsyncIterable<CanonicalStreamEvent>> {
        async function* gen(): AsyncIterable<CanonicalStreamEvent> {
          yield { type: 'text_delta', text: 'A' }
          yield { type: 'text_delta', text: 'B' }
          yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 3 } }
          yield { type: 'message_stop', stopReason: 'end_turn' }
        }
        return gen()
      },
    } as unknown as KiroUpstreamClient

    const adapter = new KiroAdapter({ client: mockClient, cacheTracker: cacheStub })

    const out: CanonicalStreamEvent[] = []
    for await (const ev of adapter.chatStream(ir, { requestId: 'r1', account, credential })) {
      out.push(ev)
    }

    // 增量顺序：text_delta('A'), text_delta('B'), usage, message_stop
    expect(out).toHaveLength(4)
    expect(out[0]).toEqual({ type: 'text_delta', text: 'A' })
    expect(out[1]).toEqual({ type: 'text_delta', text: 'B' })
    expect(out[2].type).toBe('usage')
    expect(out[3]).toEqual({ type: 'message_stop', stopReason: 'end_turn' })
  })

  it('usage 经 applyCacheToUsage：cacheControl 命中时 cacheReadTokens 正确', async () => {
    // cacheControl 有值时，第二次请求应命中 read
    const mockClient = {
      async openStream(_envelope: any, _ctx: any, _model: string, _req: any): Promise<AsyncIterable<CanonicalStreamEvent>> {
        async function* gen(): AsyncIterable<CanonicalStreamEvent> {
          yield { type: 'usage', usage: { inputTokens: 2000, outputTokens: 5 } }
          yield { type: 'message_stop', stopReason: 'end_turn' }
        }
        return gen()
      },
    } as unknown as KiroUpstreamClient

    // 使用真实 PromptCacheTracker 验证 cacheReadTokens
    const { PromptCacheTracker } = await import('../../../src/main/contexts/apiProxy/domain/usage/prompt-cache-tracker')
    const cacheTracker = new PromptCacheTracker()
    const adapter = new KiroAdapter({ client: mockClient, cacheTracker })

    const cacheIr: CanonicalRequest = {
      ...ir,
      model: 'claude-sonnet-4.5',
      cacheControl: [{ value: 's', tokens: 2000, ttl: 300000, isMessageEnd: true }],
    }
    const ctx = { requestId: 'r1', account, credential }

    // 第一次：cache creation，无 read
    const out1: CanonicalStreamEvent[] = []
    for await (const ev of adapter.chatStream(cacheIr, { ...ctx, requestId: 'r1' })) out1.push(ev)
    const usage1 = out1.find(e => e.type === 'usage')
    if (usage1?.type === 'usage') expect(usage1.usage.cacheReadTokens ?? 0).toBe(0)

    // 第二次：cache read 命中
    const out2: CanonicalStreamEvent[] = []
    for await (const ev of adapter.chatStream(cacheIr, { ...ctx, requestId: 'r2' })) out2.push(ev)
    const usage2 = out2.find(e => e.type === 'usage')
    if (usage2?.type === 'usage') expect((usage2.usage.cacheReadTokens ?? 0)).toBeGreaterThan(0)
  })
})
