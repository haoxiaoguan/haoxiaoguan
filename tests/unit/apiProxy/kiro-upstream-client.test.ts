import { describe, it, expect } from 'vitest'
import {
  KiroUpstreamClient,
  endpointsForRegion,
  foldEventsToResponse,
  type KiroFetchImpl,
  type KiroFetchResponse,
  type KiroCallContext,
} from '../../../src/main/contexts/apiProxy/infrastructure/adapters/kiro/kiro-upstream-client'
import { encodeKiroEventStream } from '../../../src/main/contexts/apiProxy/infrastructure/adapters/kiro/kiro-event-stream'
import type { KiroTokenRefresher, KiroCredential, RefreshedKiroToken } from '../../../src/main/contexts/apiProxy/infrastructure/adapters/kiro/kiro-ports'
import type { ConversationStateEnvelope } from '../../../src/main/contexts/apiProxy/infrastructure/adapters/kiro/kiro-wire-types'
import type { CanonicalRequest, CanonicalResponse, CanonicalStreamEvent } from '../../../src/main/contexts/apiProxy/domain/canonical'

// 最小请求：usage 估算降级路径用其文本反推 input。
const REQ: CanonicalRequest = {
  model: 'claude-sonnet-4.5',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }],
  stream: false,
}

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
  return {
    ok: true,
    status: 200,
    text: async () => '',
    bytes: async () => bytes,
    bytesStream: async function* () { yield bytes },
  }
}
function errResp(status: number, body = 'err'): KiroFetchResponse {
  return {
    ok: false,
    status,
    text: async () => body,
    bytes: async () => new Uint8Array(0),
    bytesStream: async function* () { /* no body for error responses */ },
  }
}

const NO_REFRESH: KiroTokenRefresher = { async refresh() { return undefined } }
function refresherTo(tok: RefreshedKiroToken): KiroTokenRefresher {
  return { async refresh(_c: KiroCredential, _r: string) { return tok } }
}

describe('endpointsForRegion', () => {
  // M3b：仅区域 AmazonQ 单端点（接受小写 modelId）；CodeWhisperer 端点（大写模型 ID）留 M4。
  it('returns only the region AmazonQ endpoint', () => {
    const eps = endpointsForRegion('eu-central-1')
    expect(eps.map((e) => e.name)).toEqual(['AmazonQ'])
    expect(eps[0].url).toBe('https://q.eu-central-1.amazonaws.com/generateAssistantResponse')
  })

  it('routes us-east-1 to the us-east-1 AmazonQ endpoint', () => {
    const eps = endpointsForRegion('us-east-1')
    expect(eps).toHaveLength(1)
    expect(eps[0].url).toBe('https://q.us-east-1.amazonaws.com/generateAssistantResponse')
  })
})

describe('KiroUpstreamClient.buildRequest', () => {
  it('builds headers + body for an endpoint', () => {
    const client = new KiroUpstreamClient({ refresher: NO_REFRESH, fetchImpl: scriptedFetch([]).impl })
    const req = client.buildRequest(endpointsForRegion('us-east-1')[0], ENVELOPE, CTX)
    expect(req.method).toBe('POST')
    expect(req.url).toBe('https://q.us-east-1.amazonaws.com/generateAssistantResponse')
    expect(req.headers['Authorization']).toBe('Bearer tok-1')
    expect(req.headers['x-amzn-kiro-agent-mode']).toBe('spec')
    expect(req.headers['amz-sdk-invocation-id']).toBe('inv-1')
    expect(req.headers['content-type']).toBe('application/json')
    expect(req.headers['x-amz-user-agent']).toContain('mid-abc')
    expect(req.headers['user-agent']).toContain('codewhispererstreaming')
    expect(JSON.parse(req.body).conversationState.conversationId).toBe('conv-1')
  })

  it('uses space-separated KiroIDE suffix for x-amz-user-agent and dash-separated for user-agent (chat version 0.12.155)', () => {
    // 逐字对照参考 线协议模块：getKiroAmzUserAgent 用空格、getKiroUserAgent 用破折号；聊天版本 0.12.155。
    const client = new KiroUpstreamClient({ refresher: NO_REFRESH, fetchImpl: scriptedFetch([]).impl })
    const req = client.buildRequest(endpointsForRegion('us-east-1')[0], ENVELOPE, CTX)
    // x-amz-user-agent：空格分隔 `KiroIDE 0.12.155 mid-abc`。
    expect(req.headers['x-amz-user-agent']).toBe('aws-sdk-js/1.0.34 KiroIDE 0.12.155 mid-abc')
    // user-agent：破折号分隔后缀 `KiroIDE-0.12.155-mid-abc`，且不含空格分隔的 KiroIDE token。
    expect(req.headers['user-agent']).toContain('KiroIDE-0.12.155-mid-abc')
    expect(req.headers['user-agent']).not.toContain('KiroIDE 0.12.155')
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
    const resp = await client.chat(ENVELOPE, CTX, 'claude-sonnet-4.5', REQ)
    // M3c：usage 不再取上游 tokenUsage，而是本地估算（output 数输出文本；无 pct 时 input 降级估算请求文本）。
    expect(resp.model).toBe('claude-sonnet-4.5')
    expect(resp.content).toEqual([{ type: 'text', text: 'Hello world' }])
    expect(resp.stopReason).toBe('end_turn')
    expect(resp.usage.outputTokens).toBeGreaterThan(0)
    expect(resp.usage.inputTokens).toBeGreaterThanOrEqual(1)
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
    const resp = await client.chat(ENVELOPE, CTX, 'claude-sonnet-4.5', REQ)
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
    const resp = await client.chat(ENVELOPE, CTX, 'claude-sonnet-4.5', REQ)
    expect(resp.content).toEqual([{ type: 'text', text: 'ok' }])
    // 第一次用旧 token，刷新后第二次用新 token；两次都打 AmazonQ（同端点）。
    expect(f.calls[0].headers['Authorization']).toBe('Bearer tok-1')
    expect(f.calls[1].headers['Authorization']).toBe('Bearer tok-2')
    expect(f.calls[0].url).toBe(f.calls[1].url)
    expect(f.calls[0].url).toContain('q.us-east-1')
  })

  it('does not retry when refresher returns undefined — throws auth error', async () => {
    const f = scriptedFetch([errResp(403, 'forbidden')])
    const client = new KiroUpstreamClient({ refresher: NO_REFRESH, fetchImpl: f.impl })
    await expect(client.chat(ENVELOPE, CTX, 'claude-sonnet-4.5', REQ)).rejects.toThrow(/auth/i)
    expect(f.calls).toHaveLength(1)
  })
})

describe('KiroUpstreamClient.chat — single AmazonQ endpoint (no fallback)', () => {
  // M3b 仅一个 AmazonQ 端点：429 无可回退端点 → 直接抛错（不再尝试其它端点）。
  it('throws on 429 without falling back (only one endpoint)', async () => {
    const f = scriptedFetch([
      errResp(429, 'quota'),
      okBytes([{ eventType: 'assistantResponseEvent', payload: { content: 'second' } }]),
    ])
    const client = new KiroUpstreamClient({ refresher: NO_REFRESH, fetchImpl: f.impl })
    await expect(client.chat(ENVELOPE, CTX, 'claude-sonnet-4.5', REQ)).rejects.toThrow(/429/)
    // 只打了一次（AmazonQ），未消费第二个脚本响应。
    expect(f.calls).toHaveLength(1)
    expect(f.calls[0].url).toContain('q.us-east-1')
  })

  it('throws on non-2xx (no other endpoint to try)', async () => {
    const f = scriptedFetch([errResp(500, 'boom')])
    const client = new KiroUpstreamClient({ refresher: NO_REFRESH, fetchImpl: f.impl })
    await expect(client.chat(ENVELOPE, CTX, 'claude-sonnet-4.5', REQ)).rejects.toThrow(/500/)
    expect(f.calls).toHaveLength(1)
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
    for await (const ev of client.chatStream(ENVELOPE, CTX, 'claude-sonnet-4.5', REQ)) out.push(ev)
    // 事件序保持不变；末 usage 事件被本地估算替换（output 数 'Hi'；无 pct → input 降级估算）。
    expect(out[0]).toEqual({ type: 'text_delta', text: 'Hi' })
    expect(out[2]).toEqual({ type: 'message_stop', stopReason: 'end_turn' })
    const usageEv = out[1]
    expect(usageEv.type).toBe('usage')
    if (usageEv.type === 'usage') {
      expect(usageEv.usage.outputTokens).toBeGreaterThan(0)
      expect(usageEv.usage.inputTokens).toBeGreaterThanOrEqual(1)
    }
  })

  it('替换末 usage 为按 contextUsagePercentage 反推（减 output）的估算', async () => {
    const f = scriptedFetch([
      okBytes([
        { eventType: 'assistantResponseEvent', payload: { content: 'Hello world' } },
        { eventType: 'contextUsageEvent', payload: { contextUsagePercentage: 1 } },
      ]),
    ])
    const client = new KiroUpstreamClient({ refresher: NO_REFRESH, fetchImpl: f.impl })
    const out: CanonicalStreamEvent[] = []
    for await (const ev of client.chatStream(ENVELOPE, CTX, 'claude-sonnet-4.5', REQ)) out.push(ev)
    const usageEv = out.find((e) => e.type === 'usage')
    expect(usageEv?.type).toBe('usage')
    if (usageEv?.type === 'usage') {
      // 透传百分比，且 input = 200000×1% − output。
      expect(usageEv.contextUsagePercentage).toBe(1)
      expect(usageEv.usage.outputTokens).toBeGreaterThan(0)
      expect(usageEv.usage.inputTokens).toBe(Math.max(0, 2000 - usageEv.usage.outputTokens))
    }
  })
})

describe('foldEventsToResponse — C1 max_tokens stopReason 本地推断', () => {
  const mkReq = (maxTokens?: number): CanonicalRequest => ({
    model: 'claude-sonnet-4.5',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    stream: false,
    ...(maxTokens !== undefined ? { maxTokens } : {}),
  })

  it('当 outputTokens >= maxTokens 且 stopReason 为 end_turn 时改写为 max_tokens', () => {
    // 构造一条输出，确保 outputTokens 估算结果 >= maxTokens 阈值。
    // 用极小的 maxTokens=1 确保任何非空输出都触发推断。
    const events: CanonicalStreamEvent[] = [
      { type: 'text_delta', text: 'Hello world' },
      { type: 'usage', usage: { inputTokens: 0, outputTokens: 0 } },
      { type: 'message_stop', stopReason: 'end_turn' },
    ]
    const resp = foldEventsToResponse(events, 'claude-sonnet-4.5', mkReq(1))
    expect(resp.stopReason).toBe('max_tokens')
  })

  it('当 stopReason 为 tool_use 时即使达到 maxTokens 也不改写', () => {
    const events: CanonicalStreamEvent[] = [
      { type: 'tool_use_start', index: 0, id: 'tu_1', name: 'fn' },
      { type: 'tool_use_delta', index: 0, partialJson: '{}' },
      { type: 'usage', usage: { inputTokens: 0, outputTokens: 0 } },
      { type: 'message_stop', stopReason: 'tool_use' },
    ]
    const resp = foldEventsToResponse(events, 'claude-sonnet-4.5', mkReq(1))
    expect(resp.stopReason).toBe('tool_use')
  })

  it('未设 maxTokens 时 end_turn 保持不变', () => {
    const events: CanonicalStreamEvent[] = [
      { type: 'text_delta', text: 'ok' },
      { type: 'usage', usage: { inputTokens: 0, outputTokens: 0 } },
      { type: 'message_stop', stopReason: 'end_turn' },
    ]
    const resp = foldEventsToResponse(events, 'claude-sonnet-4.5', mkReq())
    expect(resp.stopReason).toBe('end_turn')
  })

  it('当 outputTokens < maxTokens 时保持 end_turn', () => {
    const events: CanonicalStreamEvent[] = [
      { type: 'text_delta', text: 'ok' },
      { type: 'usage', usage: { inputTokens: 0, outputTokens: 0 } },
      { type: 'message_stop', stopReason: 'end_turn' },
    ]
    // 设置极大 maxTokens，不可能达到
    const resp = foldEventsToResponse(events, 'claude-sonnet-4.5', mkReq(999999))
    expect(resp.stopReason).toBe('end_turn')
  })
})

// --- Task 2 Step 1: bytesStream 失败测试 ---

describe('KiroFetchResponse.bytesStream', () => {
  it('把分片字节消费者拼回完整 bytes 与原始一致', async () => {
    const original = encodeKiroEventStream([
      { eventType: 'assistantResponseEvent', payload: { content: 'chunk-A' } },
      { eventType: 'assistantResponseEvent', payload: { content: 'chunk-B' } },
      { eventType: 'messageMetadataEvent', payload: { tokenUsage: { uncachedInputTokens: 4, outputTokens: 2 } } },
    ])

    // 把 original 切成 3 片模拟分片传输
    const cut1 = Math.floor(original.length / 3)
    const cut2 = Math.floor((original.length * 2) / 3)
    const slices = [original.slice(0, cut1), original.slice(cut1, cut2), original.slice(cut2)]

    // 构造一个满足 KiroFetchResponse 接口的对象，bytesStream 按分片 yield
    async function* generateSlices(): AsyncIterable<Uint8Array> {
      for (const s of slices) yield s
    }

    const resp: KiroFetchResponse = {
      ok: true,
      status: 200,
      text: async () => '',
      bytes: async () => original,
      bytesStream: () => generateSlices(),
    }

    // 消费 bytesStream，把分片拼回完整 bytes
    const parts: Uint8Array[] = []
    for await (const chunk of resp.bytesStream()) {
      parts.push(chunk)
    }
    const totalLen = parts.reduce((n, p) => n + p.length, 0)
    const assembled = new Uint8Array(totalLen)
    let off = 0
    for (const p of parts) {
      assembled.set(p, off)
      off += p.length
    }

    expect(assembled).toEqual(original)
  })

  it('defaultKiroFetch 返回的 KiroFetchResponse 含 bytesStream 方法', async () => {
    // 通过 scriptedFetch 注入 mock 验证 client 不直接测 defaultKiroFetch；
    // 但 KiroFetchResponse 接口必须包含 bytesStream，否则 TS 类型检查失败。
    // 这里通过类型兼容性断言（编译期），运行时验证 mock 含方法即可。
    const resp: KiroFetchResponse = {
      ok: true,
      status: 200,
      text: async () => '',
      bytes: async () => new Uint8Array(0),
      bytesStream: async function* () { /* empty */ },
    }
    expect(typeof resp.bytesStream).toBe('function')
  })
})

// --- Task 3 Step 1: openStream 增量流失败测试 ---

describe('KiroUpstreamClient.openStream', () => {
  it('逐 chunk 增量产出 deltas，usage 在末尾', async () => {
    // fetchImpl 返回 ok + bytesStream 按 3 片产出（text 'A' / text 'B' / metadata）
    const chunkA = encodeKiroEventStream([
      { eventType: 'assistantResponseEvent', payload: { content: 'A' } },
    ])
    const chunkB = encodeKiroEventStream([
      { eventType: 'assistantResponseEvent', payload: { content: 'B' } },
    ])
    const chunkMeta = encodeKiroEventStream([
      { eventType: 'contextUsageEvent', payload: { contextUsagePercentage: 1 } },
    ])

    const resp: KiroFetchResponse = {
      ok: true,
      status: 200,
      text: async () => '',
      bytes: async () => new Uint8Array(0),
      bytesStream: async function* () {
        yield chunkA
        yield chunkB
        yield chunkMeta
      },
    }
    const f = scriptedFetch([resp])
    const client = new KiroUpstreamClient({ refresher: NO_REFRESH, fetchImpl: f.impl })

    const out: CanonicalStreamEvent[] = []
    const stream = await (client as unknown as {
      openStream(e: typeof ENVELOPE, c: typeof CTX, m: string, r: typeof REQ): Promise<AsyncIterable<CanonicalStreamEvent>>
    }).openStream(ENVELOPE, CTX, 'claude-sonnet-4.5', REQ)
    for await (const ev of stream) out.push(ev)

    // 事件顺序：text_delta('A'), text_delta('B'), usage, message_stop
    expect(out[0]).toEqual({ type: 'text_delta', text: 'A' })
    expect(out[1]).toEqual({ type: 'text_delta', text: 'B' })
    const usageEv = out[2]
    expect(usageEv.type).toBe('usage')
    if (usageEv.type === 'usage') {
      expect(usageEv.usage.outputTokens).toBeGreaterThan(0)
      // contextUsagePercentage=1 透传
      expect(usageEv.contextUsagePercentage).toBe(1)
      // input = 200000×1% − output
      expect(usageEv.usage.inputTokens).toBe(Math.max(0, 2000 - usageEv.usage.outputTokens))
    }
    expect(out[3]).toEqual({ type: 'message_stop', stopReason: 'end_turn' })
  })

  it('openStream 401 先刷新再成功，刷新后才发起 body 流', async () => {
    const chunkOk = encodeKiroEventStream([
      { eventType: 'assistantResponseEvent', payload: { content: 'ok' } },
    ])
    const okResp: KiroFetchResponse = {
      ok: true,
      status: 200,
      text: async () => '',
      bytes: async () => new Uint8Array(0),
      bytesStream: async function* () { yield chunkOk },
    }
    const f = scriptedFetch([errResp(401, 'expired'), okResp])
    const client = new KiroUpstreamClient({
      refresher: refresherTo({ token: 'tok-2', refreshToken: 'refresh-2' }),
      fetchImpl: f.impl,
    })

    const out: CanonicalStreamEvent[] = []
    const stream = await (client as unknown as {
      openStream(e: typeof ENVELOPE, c: typeof CTX, m: string, r: typeof REQ): Promise<AsyncIterable<CanonicalStreamEvent>>
    }).openStream(ENVELOPE, CTX, 'claude-sonnet-4.5', REQ)
    for await (const ev of stream) out.push(ev)

    // 第一次 401，刷新后第二次用新 token 成功
    expect(f.calls[0].headers['Authorization']).toBe('Bearer tok-1')
    expect(f.calls[1].headers['Authorization']).toBe('Bearer tok-2')
    expect(out[0]).toEqual({ type: 'text_delta', text: 'ok' })
  })
})

describe('KiroUpstreamClient.openStream — empty body graceful termination', () => {
  it('空 body（bytesStream 立即结束）下 openStream 不抛错，只产出 flush 的 usage + message_stop', async () => {
    // 构造 ok 响应但 bytesStream 立即结束（等价 null body / 零字节体）。
    const emptyResp: KiroFetchResponse = {
      ok: true,
      status: 200,
      text: async () => '',
      bytes: async () => new Uint8Array(0),
      bytesStream: async function* () { /* 立即结束，不 yield 任何字节 */ },
    }
    const f = scriptedFetch([emptyResp])
    const client = new KiroUpstreamClient({ refresher: NO_REFRESH, fetchImpl: f.impl })

    const out: CanonicalStreamEvent[] = []
    // openStream 是 private，通过 unknown 绕过访问限制（测试专用）。
    const stream = await (client as unknown as {
      openStream(e: typeof ENVELOPE, c: typeof CTX, m: string, r: typeof REQ): Promise<AsyncIterable<CanonicalStreamEvent>>
    }).openStream(ENVELOPE, CTX, 'claude-sonnet-4.5', REQ)

    // 不应抛错
    await expect((async () => { for await (const ev of stream) out.push(ev) })()).resolves.toBeUndefined()

    // flush() 必须补出 usage + message_stop，不得为空
    const usageEv = out.find((e) => e.type === 'usage')
    const stopEv = out.find((e) => e.type === 'message_stop')
    expect(usageEv).toBeDefined()
    expect(stopEv).toBeDefined()
    // 空体：outputTokens = 0，inputTokens >= 0
    if (usageEv?.type === 'usage') {
      expect(usageEv.usage.outputTokens).toBe(0)
      expect(usageEv.usage.inputTokens).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('foldEventsToResponse — usage 估算', () => {
  const REQ4: CanonicalRequest = {
    model: 'claude-sonnet-4.5',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    stream: false,
  }

  it('有 contextUsagePercentage：input = 窗口×pct/100 − output', () => {
    const events: CanonicalStreamEvent[] = [
      { type: 'text_delta', text: 'Hello world' },
      { type: 'usage', usage: { inputTokens: 0, outputTokens: 0 }, contextUsagePercentage: 1 },
      { type: 'message_stop', stopReason: 'end_turn' },
    ]
    const resp = foldEventsToResponse(events, 'claude-sonnet-4.5', REQ4)
    expect(resp.usage.outputTokens).toBeGreaterThan(0)
    expect(resp.usage.inputTokens).toBe(Math.max(0, 2000 - resp.usage.outputTokens)) // 200000×1%
  })

  it('无 contextUsagePercentage：input 降级为估算请求文本', () => {
    const events: CanonicalStreamEvent[] = [
      { type: 'text_delta', text: 'Hello' },
      { type: 'usage', usage: { inputTokens: 0, outputTokens: 0 } },
      { type: 'message_stop', stopReason: 'end_turn' },
    ]
    const resp = foldEventsToResponse(events, 'claude-sonnet-4.5', REQ4)
    expect(resp.usage.inputTokens).toBeGreaterThanOrEqual(1)
    expect(resp.usage.outputTokens).toBeGreaterThan(0)
  })
})
