import { describe, it, expect } from 'vitest'
import { KiroAdapter } from '../../../src/main/contexts/apiProxy/infrastructure/adapters/kiro/kiro-adapter'
import { KiroUpstreamClient } from '../../../src/main/contexts/apiProxy/infrastructure/adapters/kiro/kiro-upstream-client'
import { KiroUpstreamSuspendedError } from '../../../src/main/contexts/apiProxy/infrastructure/adapters/kiro/kiro-error'
import type { CanonicalRequest } from '../../../src/main/contexts/apiProxy/domain/canonical'

const ir: CanonicalRequest = { model: 'claude-sonnet-4.5', system: '', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] }
const account = { id: 'acc-1', email: 'a@x', isActive: true }
const credential = { token: 'TKN-1' }
const cacheStub = { buildProfile: () => null, compute: () => ({ cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }), update: () => {} } as any

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
    const fetchImpl = async () => ({ ok: false, status: 403, text: async () => '{"reason":"TEMPORARILY_SUSPENDED"}', bytes: async () => new Uint8Array() })
    const client = new KiroUpstreamClient({ fetchImpl: fetchImpl as any, refresher: { async refresh() { refreshCalls++; return undefined } } })
    const callCtx = { accessToken: 't', region: 'us-east-1', machineId: 'm', agentMode: 'spec' as const, invocationId: 'i' }
    await expect(client.chat({} as any, callCtx, 'claude-sonnet-4.5', ir)).rejects.toBeInstanceOf(KiroUpstreamSuspendedError)
    expect(refreshCalls).toBe(0) // suspended 不触发刷新
  })
})
