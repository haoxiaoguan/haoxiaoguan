import { describe, it, expect } from 'vitest'
import {
  KiroUpstreamClient,
  endpointsForRegion,
  type KiroFetchImpl,
  type KiroFetchResponse,
  type KiroCallContext,
} from '../../../src/main/contexts/apiProxy/infrastructure/adapters/kiro/kiro-upstream-client'
import { encodeKiroEventStream } from '../../../src/main/contexts/apiProxy/infrastructure/adapters/kiro/kiro-event-stream'
import type { KiroTokenRefresher, KiroCredential, RefreshedKiroToken } from '../../../src/main/contexts/apiProxy/infrastructure/adapters/kiro/kiro-ports'
import type { ConversationStateEnvelope } from '../../../src/main/contexts/apiProxy/infrastructure/adapters/kiro/kiro-wire-types'
import type { CanonicalResponse, CanonicalStreamEvent } from '../../../src/main/contexts/apiProxy/domain/canonical'

const ENVELOPE: ConversationStateEnvelope = {
  conversationState: {
    chatTriggerType: 'MANUAL',
    conversationId: 'conv-1',
    agentTaskType: 'vibe',
    currentMessage: { userInputMessage: { content: 'hello', modelId: 'claude-sonnet-4.5', origin: 'AI_EDITOR' } },
  },
  profileArn: 'arn:aws:codewhisperer:us-east-1:111122223333:profile/ABC',
}

const CTX: KiroCallContext = {
  accessToken: 'tok-1',
  refreshToken: 'refresh-1',
  region: 'us-east-1',
  profileArn: 'arn:aws:codewhisperer:us-east-1:111122223333:profile/ABC',
  machineId: 'mid-abc',
  agentMode: 'spec',
  invocationId: 'inv-1',
}

// 脚本化 fetch：按调用序返回预设响应，记录每次 url/init。
function scriptedFetch(responses: KiroFetchResponse[]) {
  const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = []
  let i = 0
  const impl: KiroFetchImpl = async (url, init) => {
    calls.push({ url, headers: init.headers, body: init.body })
    const r = responses[Math.min(i, responses.length - 1)]
    i++
    return r
  }
  return { impl, calls }
}

function okBytes(list: { eventType: string; payload: unknown }[]): KiroFetchResponse {
  const bytes = encodeKiroEventStream(list)
  return { ok: true, status: 200, text: async () => '', bytes: async () => bytes }
}
function errResp(status: number, body = 'err'): KiroFetchResponse {
  return { ok: false, status, text: async () => body, bytes: async () => new Uint8Array(0) }
}

const NO_REFRESH: KiroTokenRefresher = { async refresh() { return undefined } }
function refresherTo(tok: RefreshedKiroToken): KiroTokenRefresher {
  return { async refresh(_c: KiroCredential, _r: string) { return tok } }
}

describe('endpointsForRegion', () => {
  it('returns CodeWhisperer first then region AmazonQ', () => {
    const eps = endpointsForRegion('eu-central-1')
    expect(eps.map((e) => e.name)).toEqual(['CodeWhisperer', 'AmazonQ'])
    expect(eps[0].url).toBe('https://codewhisperer.us-east-1.amazonaws.com/generateAssistantResponse')
    expect(eps[1].url).toBe('https://q.eu-central-1.amazonaws.com/generateAssistantResponse')
  })
})

describe('KiroUpstreamClient.buildRequest', () => {
  it('builds headers + body for an endpoint', () => {
    const client = new KiroUpstreamClient({ refresher: NO_REFRESH, fetchImpl: scriptedFetch([]).impl })
    const req = client.buildRequest(endpointsForRegion('us-east-1')[0], ENVELOPE, CTX)
    expect(req.method).toBe('POST')
    expect(req.url).toBe('https://codewhisperer.us-east-1.amazonaws.com/generateAssistantResponse')
    expect(req.headers['Authorization']).toBe('Bearer tok-1')
    expect(req.headers['x-amzn-kiro-agent-mode']).toBe('spec')
    expect(req.headers['amz-sdk-invocation-id']).toBe('inv-1')
    expect(req.headers['content-type']).toBe('application/json')
    expect(req.headers['x-amz-user-agent']).toContain('mid-abc')
    expect(req.headers['user-agent']).toContain('codewhispererstreaming')
    expect(JSON.parse(req.body).conversationState.conversationId).toBe('conv-1')
  })

  it('uses vibe agent-mode when ctx says so', () => {
    const client = new KiroUpstreamClient({ refresher: NO_REFRESH, fetchImpl: scriptedFetch([]).impl })
    const req = client.buildRequest(endpointsForRegion('us-east-1')[0], ENVELOPE, { ...CTX, agentMode: 'vibe' })
    expect(req.headers['x-amzn-kiro-agent-mode']).toBe('vibe')
  })
})

describe('KiroUpstreamClient.chat — success folding', () => {
  it('folds text + usage + stop into a CanonicalResponse', async () => {
    const f = scriptedFetch([
      okBytes([
        { eventType: 'assistantResponseEvent', payload: { content: 'Hello ' } },
        { eventType: 'assistantResponseEvent', payload: { content: 'world' } },
        { eventType: 'messageMetadataEvent', payload: { tokenUsage: { uncachedInputTokens: 10, outputTokens: 5 } } },
      ]),
    ])
    const client = new KiroUpstreamClient({ refresher: NO_REFRESH, fetchImpl: f.impl })
    const resp = await client.chat(ENVELOPE, CTX, 'claude-sonnet-4.5')
    expect(resp).toEqual<CanonicalResponse>({
      model: 'claude-sonnet-4.5',
      content: [{ type: 'text', text: 'Hello world' }],
      stopReason: 'end_turn',
      usage: { inputTokens: 10, outputTokens: 5 },
    })
    expect(f.calls).toHaveLength(1)
  })

  it('folds tool_use stream into a tool_use block with parsed input', async () => {
    const f = scriptedFetch([
      okBytes([
        { eventType: 'assistantResponseEvent', payload: { content: 'use tool' } },
        { eventType: 'toolUseEvent', payload: { toolUseId: 'tu_1', name: 'get_weather' } },
        { eventType: 'toolUseEvent', payload: { toolUseId: 'tu_1', input: '{"city":"SF"}' } },
        { eventType: 'toolUseEvent', payload: { toolUseId: 'tu_1', stop: true } },
        { eventType: 'messageMetadataEvent', payload: { tokenUsage: { uncachedInputTokens: 7, outputTokens: 3 } } },
      ]),
    ])
    const client = new KiroUpstreamClient({ refresher: NO_REFRESH, fetchImpl: f.impl })
    const resp = await client.chat(ENVELOPE, CTX, 'claude-sonnet-4.5')
    expect(resp.stopReason).toBe('tool_use')
    expect(resp.content).toEqual([
      { type: 'text', text: 'use tool' },
      { type: 'tool_use', id: 'tu_1', name: 'get_weather', input: { city: 'SF' } },
    ])
  })
})

describe('KiroUpstreamClient.chat — 401 refresh retry', () => {
  it('refreshes once on 401 then retries the SAME endpoint with the new token', async () => {
    const f = scriptedFetch([
      errResp(401, 'expired'),
      okBytes([{ eventType: 'assistantResponseEvent', payload: { content: 'ok' } }]),
    ])
    const client = new KiroUpstreamClient({
      refresher: refresherTo({ token: 'tok-2', refreshToken: 'refresh-2' }),
      fetchImpl: f.impl,
    })
    const resp = await client.chat(ENVELOPE, CTX, 'claude-sonnet-4.5')
    expect(resp.content).toEqual([{ type: 'text', text: 'ok' }])
    // 第一次用旧 token，刷新后第二次用新 token；两次都打 CodeWhisperer（同端点）。
    expect(f.calls[0].headers['Authorization']).toBe('Bearer tok-1')
    expect(f.calls[1].headers['Authorization']).toBe('Bearer tok-2')
    expect(f.calls[0].url).toBe(f.calls[1].url)
  })

  it('does not retry when refresher returns undefined — throws auth error', async () => {
    const f = scriptedFetch([errResp(403, 'forbidden')])
    const client = new KiroUpstreamClient({ refresher: NO_REFRESH, fetchImpl: f.impl })
    await expect(client.chat(ENVELOPE, CTX, 'claude-sonnet-4.5')).rejects.toThrow(/auth/i)
    expect(f.calls).toHaveLength(1)
  })
})

describe('KiroUpstreamClient.chat — endpoint fallback', () => {
  it('falls back to AmazonQ on 429 of CodeWhisperer', async () => {
    const f = scriptedFetch([
      errResp(429, 'quota'),
      okBytes([{ eventType: 'assistantResponseEvent', payload: { content: 'second' } }]),
    ])
    const client = new KiroUpstreamClient({ refresher: NO_REFRESH, fetchImpl: f.impl })
    const resp = await client.chat(ENVELOPE, CTX, 'claude-sonnet-4.5')
    expect(resp.content).toEqual([{ type: 'text', text: 'second' }])
    expect(f.calls[0].url).toContain('codewhisperer.us-east-1')
    expect(f.calls[1].url).toContain('q.us-east-1')
  })

  it('throws when all endpoints fail', async () => {
    const f = scriptedFetch([errResp(500, 'boom')])
    const client = new KiroUpstreamClient({ refresher: NO_REFRESH, fetchImpl: f.impl })
    await expect(client.chat(ENVELOPE, CTX, 'claude-sonnet-4.5')).rejects.toThrow(/500/)
    expect(f.calls.length).toBeGreaterThanOrEqual(2)
  })
})

describe('KiroUpstreamClient.chatStream', () => {
  it('yields parsed events from a buffered body', async () => {
    const f = scriptedFetch([
      okBytes([
        { eventType: 'assistantResponseEvent', payload: { content: 'Hi' } },
        { eventType: 'messageMetadataEvent', payload: { tokenUsage: { uncachedInputTokens: 2, outputTokens: 1 } } },
      ]),
    ])
    const client = new KiroUpstreamClient({ refresher: NO_REFRESH, fetchImpl: f.impl })
    const out: CanonicalStreamEvent[] = []
    for await (const ev of client.chatStream(ENVELOPE, CTX)) out.push(ev)
    expect(out).toEqual<CanonicalStreamEvent[]>([
      { type: 'text_delta', text: 'Hi' },
      { type: 'usage', usage: { inputTokens: 2, outputTokens: 1 } },
      { type: 'message_stop', stopReason: 'end_turn' },
    ])
  })
})
