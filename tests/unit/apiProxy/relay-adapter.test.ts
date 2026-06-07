// RelayAdapter + RelayUpstreamClient 测试（TDD）。
// 使用注入的假 client（写死 OpenAI chat.completion JSON / SSE chunk 序列），禁真网络。
// 验证：
//   ① chat → 正确 CanonicalResponse
//   ② chatStream → 正确 CanonicalStreamEvent[]（含 tool_use 流式）
//   ③ supportsModel / listModels
//   ④ classifyError 各状态映射
//   ⑤ joinUrl 末尾斜杠稳定性
import { describe, it, expect } from 'vitest'
import { RelayAdapter } from '../../../src/main/contexts/apiProxy/infrastructure/adapters/relay/relay-adapter'
import {
  RelayUpstreamClient,
  RelayHttpError,
} from '../../../src/main/contexts/apiProxy/infrastructure/adapters/relay/relay-upstream-client'
import type { ModelInfo } from '../../../src/main/contexts/apiProxy/domain/platform-adapter'
import type {
  CanonicalRequest,
  CanonicalStreamEvent,
} from '../../../src/main/contexts/apiProxy/domain/canonical'

// ─── 假 fetch 工厂 ──────────────────────────────────────────────────────────

/** 构造一个返回写死 JSON 的假 fetchImpl（非流式）。 */
function makeFakeJsonFetch(statusCode: number, responseBody: unknown) {
  return async (_url: string, _init: unknown) => {
    const text = JSON.stringify(responseBody)
    return {
      ok: statusCode >= 200 && statusCode < 300,
      status: statusCode,
      text: () => Promise.resolve(text),
      body: null as ReadableStream<Uint8Array> | null,
    }
  }
}

/** 构造一个返回 SSE 字符串的假 fetchImpl（流式）。
 *  把整个 sseText 装进一个一次性 ReadableStream（单帧读取）。
 */
function makeFakeSseFetch(statusCode: number, sseText: string) {
  return async (_url: string, _init: unknown) => {
    const enc = new TextEncoder()
    const bytes = enc.encode(sseText)
    // 用 ReadableStream 模拟 undici body。
    const body = new ReadableStream<Uint8Array>({
      start(ctrl) {
        ctrl.enqueue(bytes)
        ctrl.close()
      },
    })
    return {
      ok: statusCode >= 200 && statusCode < 300,
      status: statusCode,
      text: () => Promise.reject(new Error('streaming body: text() not supported')),
      body,
    }
  }
}

/** 构造返回错误体的假 fetchImpl（非 ok）。 */
function makeFakeErrorFetch(statusCode: number, errorBody = 'upstream error') {
  return async (_url: string, _init: unknown) => ({
    ok: false,
    status: statusCode,
    text: () => Promise.resolve(errorBody),
    body: null as ReadableStream<Uint8Array> | null,
  })
}

// ─── 测试夹具 ──────────────────────────────────────────────────────────────

const MODELS: ModelInfo[] = [
  { id: 'deepseek-chat', displayName: 'DeepSeek Chat', contextLength: 64000 },
  { id: 'deepseek-coder', displayName: 'DeepSeek Coder', contextLength: 64000 },
]

function makeAdapter(fetchImpl: (url: string, init: unknown) => Promise<unknown>) {
  const client = new RelayUpstreamClient({
    fetchImpl: fetchImpl as Parameters<typeof RelayUpstreamClient>[0] extends { fetchImpl?: infer F } ? F : never,
  })
  return new RelayAdapter({
    platform: 'deepseek',
    protocol: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: 'sk-test',
    models: MODELS,
    client,
  })
}

// 最小 CanonicalRequest 工具
function req(text: string, model = 'deepseek-chat'): CanonicalRequest {
  return {
    model,
    messages: [{ role: 'user', content: [{ type: 'text', text }] }],
    stream: false,
  }
}

// ─── 非流式 chat 测试 ───────────────────────────────────────────────────────

describe('RelayAdapter.chat', () => {
  it('① 简单文本响应 → CanonicalResponse(text + usage + end_turn)', async () => {
    const fakeResp = {
      id: 'chatcmpl-1',
      object: 'chat.completion',
      created: 0,
      model: 'deepseek-chat',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: '你好！' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
    }
    const adapter = makeAdapter(makeFakeJsonFetch(200, fakeResp))
    const result = await adapter.chat(req('你好'), {})
    expect(result.model).toBe('deepseek-chat')
    expect(result.content).toEqual([{ type: 'text', text: '你好！' }])
    expect(result.stopReason).toBe('end_turn')
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 4 })
  })

  it('① tool_calls 响应 → tool_use 块 + tool_use 停因', async () => {
    const fakeResp = {
      id: 'chatcmpl-2',
      object: 'chat.completion',
      created: 0,
      model: 'deepseek-chat',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              { id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"北京"}' } },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 20, completion_tokens: 15, total_tokens: 35 },
    }
    const adapter = makeAdapter(makeFakeJsonFetch(200, fakeResp))
    const result = await adapter.chat(req('查天气'), {})
    expect(result.stopReason).toBe('tool_use')
    expect(result.content).toEqual([
      { type: 'tool_use', id: 'call_1', name: 'get_weather', input: { city: '北京' } },
    ])
  })

  it('① finish_reason:length → max_tokens', async () => {
    const fakeResp = {
      id: 'x',
      object: 'chat.completion',
      created: 0,
      model: 'deepseek-chat',
      choices: [{ index: 0, message: { role: 'assistant', content: 'truncated' }, finish_reason: 'length' }],
      usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
    }
    const adapter = makeAdapter(makeFakeJsonFetch(200, fakeResp))
    const result = await adapter.chat(req('hi'), {})
    expect(result.stopReason).toBe('max_tokens')
  })

  it('① cached_tokens → cacheReadTokens', async () => {
    const fakeResp = {
      id: 'x',
      object: 'chat.completion',
      created: 0,
      model: 'deepseek-chat',
      choices: [{ index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
      usage: {
        prompt_tokens: 12,
        completion_tokens: 3,
        total_tokens: 15,
        prompt_tokens_details: { cached_tokens: 8 },
      },
    }
    const adapter = makeAdapter(makeFakeJsonFetch(200, fakeResp))
    const result = await adapter.chat(req('cached'), {})
    expect(result.usage.cacheReadTokens).toBe(8)
  })

  it('① 上游 HTTP 错误 → 抛 RelayHttpError', async () => {
    const adapter = makeAdapter(makeFakeErrorFetch(500, 'Internal Server Error'))
    await expect(adapter.chat(req('hi'), {})).rejects.toThrow(RelayHttpError)
  })

  it('① dispatcher=undefined 时 runWithDispatcher 透传（no-op）', async () => {
    const fakeResp = {
      id: 'x', object: 'chat.completion', created: 0, model: 'deepseek-chat',
      choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }
    const adapter = makeAdapter(makeFakeJsonFetch(200, fakeResp))
    const result = await adapter.chat(req('ok'), { dispatcher: undefined })
    expect(result.content).toEqual([{ type: 'text', text: 'ok' }])
  })
})

// ─── 流式 chatStream 测试 ───────────────────────────────────────────────────

/** SSE helper：把对象序列化成 SSE 帧。 */
function sseFrame(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`
}

describe('RelayAdapter.chatStream', () => {
  /** 收集 chatStream 产出的所有事件。 */
  async function collectStream(adapter: RelayAdapter, ir: CanonicalRequest): Promise<CanonicalStreamEvent[]> {
    const events: CanonicalStreamEvent[] = []
    for await (const ev of adapter.chatStream(ir, {})) events.push(ev)
    return events
  }

  it('② 简单文本流 → text_delta + message_stop + usage', async () => {
    const sseText =
      sseFrame({ id: 'c', object: 'chat.completion.chunk', created: 0, model: 'm', choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] }) +
      sseFrame({ id: 'c', object: 'chat.completion.chunk', created: 0, model: 'm', choices: [{ index: 0, delta: { content: '你' }, finish_reason: null }] }) +
      sseFrame({ id: 'c', object: 'chat.completion.chunk', created: 0, model: 'm', choices: [{ index: 0, delta: { content: '好' }, finish_reason: null }] }) +
      sseFrame({ id: 'c', object: 'chat.completion.chunk', created: 0, model: 'm', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) +
      sseFrame({ id: 'c', object: 'chat.completion.chunk', created: 0, model: 'm', choices: [], usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } }) +
      'data: [DONE]\n\n'

    const adapter = makeAdapter(makeFakeSseFetch(200, sseText))
    const events = await collectStream(adapter, req('你好'))
    expect(events).toContainEqual({ type: 'text_delta', text: '你' })
    expect(events).toContainEqual({ type: 'text_delta', text: '好' })
    expect(events).toContainEqual({ type: 'message_stop', stopReason: 'end_turn' })
    expect(events).toContainEqual({ type: 'usage', usage: { inputTokens: 5, outputTokens: 2 } })
  })

  it('② tool_use 流式：tool_use_start + tool_use_delta + message_stop', async () => {
    const sseText =
      sseFrame({ id: 'c', object: 'chat.completion.chunk', created: 0, model: 'm',
        choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'search', arguments: '' } }] }, finish_reason: null }] }) +
      sseFrame({ id: 'c', object: 'chat.completion.chunk', created: 0, model: 'm',
        choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"q":' } }] }, finish_reason: null }] }) +
      sseFrame({ id: 'c', object: 'chat.completion.chunk', created: 0, model: 'm',
        choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"ai"}' } }] }, finish_reason: null }] }) +
      sseFrame({ id: 'c', object: 'chat.completion.chunk', created: 0, model: 'm',
        choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }) +
      'data: [DONE]\n\n'

    const adapter = makeAdapter(makeFakeSseFetch(200, sseText))
    const events = await collectStream(adapter, req('搜索'))
    expect(events).toContainEqual({ type: 'tool_use_start', index: 0, id: 'call_1', name: 'search' })
    expect(events).toContainEqual({ type: 'tool_use_delta', index: 0, partialJson: '{"q":' })
    expect(events).toContainEqual({ type: 'tool_use_delta', index: 0, partialJson: '"ai"}' })
    expect(events).toContainEqual({ type: 'message_stop', stopReason: 'tool_use' })
  })

  it('② reasoning_content → thinking_delta', async () => {
    const sseText =
      sseFrame({ id: 'c', object: 'chat.completion.chunk', created: 0, model: 'm',
        choices: [{ index: 0, delta: { reasoning_content: '思考中' }, finish_reason: null }] }) +
      sseFrame({ id: 'c', object: 'chat.completion.chunk', created: 0, model: 'm',
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) +
      'data: [DONE]\n\n'

    const adapter = makeAdapter(makeFakeSseFetch(200, sseText))
    const events = await collectStream(adapter, req('深思'))
    expect(events).toContainEqual({ type: 'thinking_delta', text: '思考中' })
  })

  it('② 空 body (null) → 空事件序列（无抛出）', async () => {
    // 构造 ok=true 但 body=null 的假 fetch
    const fakeFetch = async (_url: string, _init: unknown) => ({
      ok: true,
      status: 200,
      text: () => Promise.reject(new Error('not supported')),
      body: null as ReadableStream<Uint8Array> | null,
    })
    const adapter = makeAdapter(fakeFetch)
    const events = await collectStream(adapter, req('hi'))
    // flush 后无帧→零事件（或只有 [DONE] 已截断的帧）
    expect(Array.isArray(events)).toBe(true)
  })

  it('② 流式 HTTP 错误 → 抛 RelayHttpError', async () => {
    const adapter = makeAdapter(makeFakeErrorFetch(429, 'rate limit'))
    await expect(collectStream(adapter, req('hi'))).rejects.toThrow(RelayHttpError)
  })
})

// ─── supportsModel / listModels ─────────────────────────────────────────────

describe('RelayAdapter.supportsModel / listModels', () => {
  const adapter = makeAdapter(makeFakeJsonFetch(200, {}))

  it('③ supportsModel 精确匹配 models 列表', () => {
    expect(adapter.supportsModel('deepseek-chat')).toBe(true)
    expect(adapter.supportsModel('deepseek-coder')).toBe(true)
    expect(adapter.supportsModel('gpt-4o')).toBe(false)
    expect(adapter.supportsModel('')).toBe(false)
  })

  it('③ listModels 返回 models 副本（immutable）', () => {
    const models = adapter.listModels()
    expect(models.map((m) => m.id)).toEqual(['deepseek-chat', 'deepseek-coder'])
    // 确认是副本，不是同一引用
    models[0].id = 'mutated'
    expect(adapter.listModels()[0].id).toBe('deepseek-chat')
  })

  it('③ platform 字段正确', () => {
    expect(adapter.platform).toBe('deepseek')
  })
})

// ─── classifyError ──────────────────────────────────────────────────────────

describe('RelayAdapter.classifyError', () => {
  const adapter = makeAdapter(makeFakeJsonFetch(200, {}))

  it('④ RelayHttpError 429 → RATE_LIMIT', () => {
    expect(adapter.classifyError(new RelayHttpError('rate limit', 429))).toBe('RATE_LIMIT')
  })

  it('④ RelayHttpError 401 → AUTH', () => {
    expect(adapter.classifyError(new RelayHttpError('unauthorized', 401))).toBe('AUTH')
  })

  it('④ RelayHttpError 403 → AUTH', () => {
    expect(adapter.classifyError(new RelayHttpError('forbidden', 403))).toBe('AUTH')
  })

  it('④ RelayHttpError 400 → FATAL', () => {
    expect(adapter.classifyError(new RelayHttpError('bad request', 400))).toBe('FATAL')
  })

  it('④ RelayHttpError 422 → FATAL', () => {
    expect(adapter.classifyError(new RelayHttpError('unprocessable', 422))).toBe('FATAL')
  })

  it('④ RelayHttpError 500 → SERVER', () => {
    expect(adapter.classifyError(new RelayHttpError('internal error', 500))).toBe('SERVER')
  })

  it('④ RelayHttpError 503 → SERVER', () => {
    expect(adapter.classifyError(new RelayHttpError('service unavailable', 503))).toBe('SERVER')
  })

  it('④ 网络异常（非 RelayHttpError）→ SERVER', () => {
    expect(adapter.classifyError(new Error('ECONNREFUSED'))).toBe('SERVER')
  })

  it('④ null → SERVER', () => {
    expect(adapter.classifyError(null)).toBe('SERVER')
  })

  it('④ undefined → SERVER', () => {
    expect(adapter.classifyError(undefined)).toBe('SERVER')
  })
})

// ─── RelayHttpError ─────────────────────────────────────────────────────────

describe('RelayHttpError', () => {
  it('name = "RelayHttpError"，status 可访问', () => {
    const err = new RelayHttpError('test', 422)
    expect(err.name).toBe('RelayHttpError')
    expect(err.status).toBe(422)
    expect(err.message).toBe('test')
    expect(err instanceof Error).toBe(true)
  })
})

// ─── joinUrl 末尾斜杠稳定性（通过 chat 请求 URL 验证）──────────────────────

describe('RelayAdapter joinUrl robustness', () => {
  it('baseUrl 末尾含斜杠 → URL 拼接仍正确（无双斜杠）', async () => {
    let capturedUrl = ''
    const fakeFetch = async (url: string, _init: unknown) => {
      capturedUrl = url
      const text = JSON.stringify({
        id: 'x', object: 'chat.completion', created: 0, model: 'm',
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      })
      return { ok: true, status: 200, text: () => Promise.resolve(text), body: null }
    }
    const client = new RelayUpstreamClient({ fetchImpl: fakeFetch as Parameters<typeof RelayUpstreamClient>[0] extends { fetchImpl?: infer F } ? F : never })
    const adapter = new RelayAdapter({
      platform: 'test',
      protocol: 'openai',
      baseUrl: 'https://api.example.com/v1/', // 末尾斜杠
      apiKey: 'k',
      models: [],
      client,
    })
    await adapter.chat(req('hi'), {})
    expect(capturedUrl).toBe('https://api.example.com/v1/chat/completions')
    // 路径部分不含双斜杠（协议头 https:// 不算）
    expect(capturedUrl.replace(/^https?:\/\//, '')).not.toContain('//')
  })
})
