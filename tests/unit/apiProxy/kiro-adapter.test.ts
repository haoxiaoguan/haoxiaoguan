import { describe, it, expect } from 'vitest'
import { KiroAdapter, NoKiroAccountError } from '../../../src/main/contexts/apiProxy/infrastructure/adapters/kiro/kiro-adapter'
import { KiroUpstreamClient, type KiroFetchImpl, type KiroFetchResponse } from '../../../src/main/contexts/apiProxy/infrastructure/adapters/kiro/kiro-upstream-client'
import { encodeKiroEventStream } from '../../../src/main/contexts/apiProxy/infrastructure/adapters/kiro/kiro-event-stream'
import type {
  KiroCredentialPort,
  KiroAccountPort,
  KiroDispatcherPort,
  KiroTokenRefresher,
  KiroCredential,
  KiroAccountInfo,
} from '../../../src/main/contexts/apiProxy/infrastructure/adapters/kiro/kiro-ports'
import type { CanonicalRequest, CanonicalResponse, CanonicalStreamEvent } from '../../../src/main/contexts/apiProxy/domain/canonical'
import type { UpstreamCtx } from '../../../src/main/contexts/apiProxy/domain/platform-adapter'

const ACCOUNT: KiroAccountInfo = {
  id: 'acc-1',
  email: 'u@example.com',
  loginProvider: 'Github',
  profilePayload: { profileArn: 'arn:aws:codewhisperer:us-east-1:111122223333:profile/SOCIAL' },
}
const CRED: KiroCredential = { token: 'tok-1', refreshToken: 'refresh-1', rawMetadata: { provider: 'Github' } }

function ports(over: Partial<{
  account: KiroAccountInfo | null
  cred: KiroCredential | null
  dispatcherCalls: string[]
}> = {}) {
  const dispatcherCalls = over.dispatcherCalls ?? []
  const accounts: KiroAccountPort = { async findActiveKiroAccount() { return over.account === undefined ? ACCOUNT : over.account } }
  const credentials: KiroCredentialPort = { async retrieve(_id) { return over.cred === undefined ? CRED : over.cred } }
  const dispatchers: KiroDispatcherPort = {
    async dispatcherForAccount(id) { dispatcherCalls.push(id); return undefined },
  }
  return { accounts, credentials, dispatchers, dispatcherCalls }
}

const NO_REFRESH: KiroTokenRefresher = { async refresh() { return undefined } }

function fetchReturning(list: { eventType: string; payload: unknown }[]): { impl: KiroFetchImpl; calls: Array<{ url: string; headers: Record<string, string> }> } {
  const calls: Array<{ url: string; headers: Record<string, string> }> = []
  const bytes = encodeKiroEventStream(list)
  const impl: KiroFetchImpl = async (url, init) => {
    calls.push({ url, headers: init.headers })
    const r: KiroFetchResponse = { ok: true, status: 200, text: async () => '', bytes: async () => bytes }
    return r
  }
  return { impl, calls }
}

function makeAdapter(fetchImpl: KiroFetchImpl, over = {}) {
  const p = ports(over)
  const client = new KiroUpstreamClient({ refresher: NO_REFRESH, fetchImpl })
  const adapter = new KiroAdapter({ credentials: p.credentials, accounts: p.accounts, dispatchers: p.dispatchers, client })
  return { adapter, ...p }
}

const REQ: CanonicalRequest = {
  model: 'claude-sonnet-4-5',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'hello kiro' }] }],
  stream: false,
}
const CTX: UpstreamCtx = { requestId: 'req-1' }

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
  it('selects account, retrieves cred, calls AmazonQ endpoint, returns folded response', async () => {
    const f = fetchReturning([
      { eventType: 'assistantResponseEvent', payload: { content: 'hi back' } },
      { eventType: 'messageMetadataEvent', payload: { tokenUsage: { uncachedInputTokens: 4, outputTokens: 2 } } },
    ])
    const { adapter, dispatcherCalls } = makeAdapter(f.impl)
    const resp = await adapter.chat(REQ, CTX)
    expect(resp).toEqual<CanonicalResponse>({
      model: 'claude-sonnet-4-5',
      content: [{ type: 'text', text: 'hi back' }],
      stopReason: 'end_turn',
      usage: { inputTokens: 4, outputTokens: 2 },
    })
    // 走了 dispatcher 解析（runWithDispatcher 外包）。
    expect(dispatcherCalls).toEqual(['acc-1'])
    // Authorization 用解密 token；invocation-id 来自 requestId（确定性）。
    expect(f.calls[0].headers['Authorization']).toBe('Bearer tok-1')
    expect(f.calls[0].headers['amz-sdk-invocation-id']).toBe('req-1')
    // M3b 端点：区域 AmazonQ（接受小写 modelId）；CodeWhisperer 大写模型 ID 端点留 M4。
    expect(f.calls[0].url).toContain('q.us-east-1')
  })

  it('throws NoKiroAccountError when no active account', async () => {
    const { adapter } = makeAdapter(fetchReturning([]).impl, { account: null })
    await expect(adapter.chat(REQ, CTX)).rejects.toBeInstanceOf(NoKiroAccountError)
  })

  it('throws NoKiroAccountError when credential missing', async () => {
    const { adapter } = makeAdapter(fetchReturning([]).impl, { cred: null })
    await expect(adapter.chat(REQ, CTX)).rejects.toBeInstanceOf(NoKiroAccountError)
  })
})

describe('KiroAdapter.chatStream', () => {
  it('yields parsed events (buffered) under the account dispatcher', async () => {
    const f = fetchReturning([
      { eventType: 'assistantResponseEvent', payload: { content: 'stream hi' } },
      { eventType: 'messageMetadataEvent', payload: { tokenUsage: { uncachedInputTokens: 3, outputTokens: 1 } } },
    ])
    const { adapter, dispatcherCalls } = makeAdapter(f.impl)
    const out: CanonicalStreamEvent[] = []
    for await (const ev of adapter.chatStream({ ...REQ, stream: true }, CTX)) out.push(ev)
    expect(out).toEqual<CanonicalStreamEvent[]>([
      { type: 'text_delta', text: 'stream hi' },
      { type: 'usage', usage: { inputTokens: 3, outputTokens: 1 } },
      { type: 'message_stop', stopReason: 'end_turn' },
    ])
    expect(dispatcherCalls).toEqual(['acc-1'])
  })
})
