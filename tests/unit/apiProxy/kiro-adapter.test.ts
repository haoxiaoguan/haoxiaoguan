import { describe, it, expect } from 'vitest'
import { KiroAdapter, NoKiroAccountError } from '../../../src/main/contexts/apiProxy/infrastructure/adapters/kiro/kiro-adapter'
import { KiroUpstreamClient, type KiroFetchImpl, type KiroFetchResponse } from '../../../src/main/contexts/apiProxy/infrastructure/adapters/kiro/kiro-upstream-client'
import { encodeKiroEventStream } from '../../../src/main/contexts/apiProxy/infrastructure/adapters/kiro/kiro-event-stream'
import { PromptCacheTracker } from '../../../src/main/contexts/apiProxy/domain/usage/prompt-cache-tracker'
import type {
  KiroTokenRefresher,
  KiroCredential,
  KiroAccountInfo,
} from '../../../src/main/contexts/apiProxy/infrastructure/adapters/kiro/kiro-ports'
import type { CanonicalRequest, CanonicalStreamEvent } from '../../../src/main/contexts/apiProxy/domain/canonical'
import type { UpstreamCtx } from '../../../src/main/contexts/apiProxy/domain/platform-adapter'

const ACCOUNT: KiroAccountInfo = {
  id: 'acc-1',
  email: 'u@example.com',
  isActive: true,
  loginProvider: 'Github',
  profilePayload: { profileArn: 'arn:aws:codewhisperer:us-east-1:111122223333:profile/SOCIAL' },
}
const CRED: KiroCredential = { token: 'tok-1', refreshToken: 'refresh-1', rawMetadata: { provider: 'Github' } }

const NO_REFRESH: KiroTokenRefresher = { async refresh() { return { kind: 'permanent' } } }

function fetchReturning(list: { eventType: string; payload: unknown }[]): { impl: KiroFetchImpl; calls: Array<{ url: string; headers: Record<string, string> }> } {
  const calls: Array<{ url: string; headers: Record<string, string> }> = []
  const bytes = encodeKiroEventStream(list)
  const impl: KiroFetchImpl = async (url, init) => {
    calls.push({ url, headers: init.headers })
    const r: KiroFetchResponse = {
      ok: true,
      status: 200,
      text: async () => '',
      bytes: async () => bytes,
      bytesStream: async function* () { yield bytes },
    }
    return r
  }
  return { impl, calls }
}

// M4 版：KiroAdapterDeps 只有 client + cacheTracker。账号/凭据/代理经 ctx 注入。
function makeAdapter(fetchImpl: KiroFetchImpl) {
  const client = new KiroUpstreamClient({ refresher: NO_REFRESH, fetchImpl })
  const adapter = new KiroAdapter({ client, cacheTracker: new PromptCacheTracker() })
  return { adapter }
}

const REQ: CanonicalRequest = {
  model: 'claude-sonnet-4-5',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'hello kiro' }] }],
  stream: false,
}
// M4：ctx 必须含 account + credential（由 FailoverAdapter 注入）。
const CTX: UpstreamCtx = { requestId: 'req-1', account: ACCOUNT, credential: CRED }

describe('KiroAdapter.supportsModel / listModels', () => {
  it('supports claude family (incl. dash-version), rejects non-claude', () => {
    const { adapter } = makeAdapter(fetchReturning([]).impl)
    expect(adapter.supportsModel('claude-sonnet-4-5')).toBe(true)
    expect(adapter.supportsModel('claude-opus-4.8')).toBe(true)
    expect(adapter.supportsModel('Claude-Haiku-4-5')).toBe(true)
    expect(adapter.supportsModel('gpt-4o')).toBe(false)
    expect(adapter.supportsModel('gemini-2.0')).toBe(false)
  })
  it('lists kiro models', () => {
    const { adapter } = makeAdapter(fetchReturning([]).impl)
    expect(adapter.listModels().map((m) => m.id)).toContain('claude-sonnet-4.5')
    expect(adapter.listModels().every((m) => m.id.startsWith('claude-'))).toBe(true)
  })
})

describe('KiroAdapter.chat', () => {
  it('uses ctx.account/credential, calls AmazonQ endpoint, returns folded response', async () => {
    const f = fetchReturning([
      { eventType: 'assistantResponseEvent', payload: { content: 'hi back' } },
      { eventType: 'messageMetadataEvent', payload: { tokenUsage: { uncachedInputTokens: 4, outputTokens: 2 } } },
    ])
    const { adapter } = makeAdapter(f.impl)
    const resp = await adapter.chat(REQ, CTX)
    // M3c：usage 本地估算；无 contextUsagePercentage → input 降级估算请求文本。
    expect(resp.model).toBe('claude-sonnet-4-5')
    expect(resp.content).toEqual([{ type: 'text', text: 'hi back' }])
    expect(resp.stopReason).toBe('end_turn')
    expect(resp.usage.outputTokens).toBeGreaterThan(0)
    expect(resp.usage.inputTokens).toBeGreaterThanOrEqual(1)
    // Authorization 用 ctx.credential.token；invocation-id 来自 requestId（确定性）。
    expect(f.calls[0].headers['Authorization']).toBe('Bearer tok-1')
    expect(f.calls[0].headers['amz-sdk-invocation-id']).toBe('req-1')
    // M3b 端点：区域 AmazonQ（接受小写 modelId）。
    expect(f.calls[0].url).toContain('q.us-east-1')
  })

  it('throws NoKiroAccountError when ctx.account is missing', async () => {
    const { adapter } = makeAdapter(fetchReturning([]).impl)
    await expect(adapter.chat(REQ, { requestId: 'r1' })).rejects.toBeInstanceOf(NoKiroAccountError)
  })

  it('throws NoKiroAccountError when ctx.credential is missing', async () => {
    const { adapter } = makeAdapter(fetchReturning([]).impl)
    await expect(adapter.chat(REQ, { requestId: 'r1', account: ACCOUNT })).rejects.toBeInstanceOf(NoKiroAccountError)
  })
})

describe('KiroAdapter cache billing', () => {
  it('cache_control 请求：首次 creation，update 后二次 read 命中', async () => {
    const events = [
      { eventType: 'assistantResponseEvent', payload: { content: 'hi' } },
      { eventType: 'contextUsageEvent', payload: { contextUsagePercentage: 50 } },
    ]
    const { adapter } = makeAdapter(fetchReturning(events).impl)
    const ir: CanonicalRequest = {
      model: 'claude-sonnet-4.5',
      stream: false,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      cacheControl: [{ value: 's', tokens: 2000, ttl: 300000, isMessageEnd: true }],
    }
    const r1 = await adapter.chat(ir, { requestId: 'r1', account: ACCOUNT, credential: CRED } as UpstreamCtx)
    expect(r1.usage.cacheReadTokens ?? 0).toBe(0)
    const r2 = await adapter.chat(ir, { requestId: 'r2', account: ACCOUNT, credential: CRED } as UpstreamCtx)
    expect(r2.usage.cacheReadTokens ?? 0).toBeGreaterThan(0)
  })
})

describe('KiroAdapter.chatStream', () => {
  it('yields parsed events (buffered) using ctx.account/credential', async () => {
    const f = fetchReturning([
      { eventType: 'assistantResponseEvent', payload: { content: 'stream hi' } },
      { eventType: 'messageMetadataEvent', payload: { tokenUsage: { uncachedInputTokens: 3, outputTokens: 1 } } },
    ])
    const { adapter } = makeAdapter(f.impl)
    const out: CanonicalStreamEvent[] = []
    for await (const ev of adapter.chatStream({ ...REQ, stream: true }, CTX)) out.push(ev)
    // M3c：事件序保持；末 usage 事件被本地估算替换（不取上游 tokenUsage）。
    expect(out[0]).toEqual({ type: 'text_delta', text: 'stream hi' })
    expect(out[2]).toEqual({ type: 'message_stop', stopReason: 'end_turn' })
    const usageEv = out[1]
    expect(usageEv.type).toBe('usage')
    if (usageEv.type === 'usage') {
      expect(usageEv.usage.outputTokens).toBeGreaterThan(0)
      expect(usageEv.usage.inputTokens).toBeGreaterThanOrEqual(1)
    }
    // Authorization 用注入的 credential.token。
    expect(f.calls[0].headers['Authorization']).toBe('Bearer tok-1')
  })
})
