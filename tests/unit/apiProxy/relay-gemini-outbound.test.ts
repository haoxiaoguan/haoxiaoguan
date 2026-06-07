// T11：第三方中转 Gemini generateContent 出站镜像转换器测试。
// 验证 IR→上游请求、上游响应→IR、上游 SSE→IR 三方向。
import { describe, it, expect } from 'vitest'
import type {
  CanonicalRequest,
  CanonicalStreamEvent,
} from '../../../src/main/contexts/apiProxy/domain/canonical'
import {
  irToGeminiRequest,
  geminiResponseToIR,
  createGeminiSseToEventsParser,
  parseGeminiSse,
} from '../../../src/main/contexts/apiProxy/infrastructure/adapters/relay/gemini-outbound'
import { GeminiCodec } from '../../../src/main/contexts/apiProxy/infrastructure/adapters/relay/gemini-codec'
import type { GeminiGenerateContentResponse } from '../../../src/main/contexts/apiProxy/infrastructure/inbound/gemini'

// ─── helpers ──────────────────────────────────────────────────────────────────

/** 包成一条 SSE data 行。 */
function sseData(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`
}

// ─── IR → Gemini 请求体 ───────────────────────────────────────────────────────

describe('irToGeminiRequest', () => {
  it('system → systemInstruction', () => {
    const ir: CanonicalRequest = {
      model: 'gemini-1.5-pro',
      system: '你是助手',
      messages: [{ role: 'user', content: [{ type: 'text', text: '你好' }] }],
      stream: false,
    }
    const out = irToGeminiRequest(ir)
    expect(out.systemInstruction).toEqual({ parts: [{ text: '你是助手' }] })
    // model 不进 body
    expect((out as Record<string, unknown>)['model']).toBeUndefined()
  })

  it('无 system 时不设置 systemInstruction', () => {
    const out = irToGeminiRequest({ model: 'm', messages: [], stream: false })
    expect(out.systemInstruction).toBeUndefined()
  })

  it('user/assistant → contents role user/model', () => {
    const ir: CanonicalRequest = {
      model: 'm',
      messages: [
        { role: 'user', content: [{ type: 'text', text: '问题' }] },
        { role: 'assistant', content: [{ type: 'text', text: '回答' }] },
      ],
      stream: false,
    }
    const out = irToGeminiRequest(ir)
    expect(out.contents[0].role).toBe('user')
    expect(out.contents[0].parts).toEqual([{ text: '问题' }])
    expect(out.contents[1].role).toBe('model')
    expect(out.contents[1].parts).toEqual([{ text: '回答' }])
  })

  it('tool_use → functionCall part', () => {
    const ir: CanonicalRequest = {
      model: 'm',
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'gemini-get_weather', name: 'get_weather', input: { city: '北京' } }],
        },
      ],
      stream: false,
    }
    const out = irToGeminiRequest(ir)
    expect(out.contents[0].parts[0]).toEqual({
      functionCall: { name: 'get_weather', args: { city: '北京' } },
    })
  })

  it('image → inlineData part', () => {
    const ir: CanonicalRequest = {
      model: 'm',
      messages: [
        { role: 'user', content: [{ type: 'image', mediaType: 'image/png', data: 'AAAA' }] },
      ],
      stream: false,
    }
    const out = irToGeminiRequest(ir)
    expect(out.contents[0].parts[0]).toEqual({
      inlineData: { mimeType: 'image/png', data: 'AAAA' },
    })
  })

  it('tool_result → functionResponse part（name 去 gemini- 前缀）', () => {
    const ir: CanonicalRequest = {
      model: 'm',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              toolUseId: 'gemini-get_weather',
              content: [{ type: 'text', text: '晴天' }],
            },
          ],
        },
      ],
      stream: false,
    }
    const out = irToGeminiRequest(ir)
    expect(out.contents[0].parts[0]).toEqual({
      functionResponse: { name: 'get_weather', response: { content: '晴天' } },
    })
  })

  it('tools → functionDeclarations', () => {
    const ir: CanonicalRequest = {
      model: 'm',
      messages: [],
      stream: false,
      tools: [{ name: 'search', description: '搜索', inputSchema: { type: 'object', properties: {} } }],
    }
    const out = irToGeminiRequest(ir)
    expect(out.tools).toEqual([{
      functionDeclarations: [{ name: 'search', description: '搜索', parameters: { type: 'object', properties: {} } }],
    }])
  })

  it('toolChoice auto/any/none/tool → toolConfig.functionCallingConfig', () => {
    const base = (toolChoice: CanonicalRequest['toolChoice']): CanonicalRequest => ({
      model: 'm', messages: [], stream: false, toolChoice,
    })
    expect(irToGeminiRequest(base({ type: 'auto' })).toolConfig).toEqual({
      functionCallingConfig: { mode: 'AUTO' },
    })
    expect(irToGeminiRequest(base({ type: 'none' })).toolConfig).toEqual({
      functionCallingConfig: { mode: 'NONE' },
    })
    expect(irToGeminiRequest(base({ type: 'any' })).toolConfig).toEqual({
      functionCallingConfig: { mode: 'ANY' },
    })
    expect(irToGeminiRequest(base({ type: 'tool', name: 'get_weather' })).toolConfig).toEqual({
      functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['get_weather'] },
    })
  })

  it('generationConfig: maxTokens/temperature/topP', () => {
    const out = irToGeminiRequest({
      model: 'm',
      messages: [],
      stream: false,
      maxTokens: 256,
      temperature: 0.7,
      topP: 0.9,
    })
    expect(out.generationConfig).toEqual({ maxOutputTokens: 256, temperature: 0.7, topP: 0.9 })
  })

  it('无 maxTokens/temperature/topP 时不设置 generationConfig', () => {
    const out = irToGeminiRequest({ model: 'm', messages: [], stream: false })
    expect(out.generationConfig).toBeUndefined()
  })
})

// ─── Gemini 响应 → IR ──────────────────────────────────────────────────────────

describe('geminiResponseToIR', () => {
  const baseResp = (override: Partial<GeminiGenerateContentResponse> = {}): GeminiGenerateContentResponse => ({
    candidates: [
      {
        content: { role: 'model', parts: [{ text: '你好！' }] },
        finishReason: 'STOP',
        index: 0,
      },
    ],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
    ...override,
  })

  it('text part → text 块 + end_turn + usage', () => {
    const ir = geminiResponseToIR(baseResp())
    expect(ir.content).toEqual([{ type: 'text', text: '你好！' }])
    expect(ir.stopReason).toBe('end_turn')
    expect(ir.usage).toEqual({ inputTokens: 10, outputTokens: 5 })
  })

  it('functionCall part → tool_use 块（id = gemini-<name>）', () => {
    const ir = geminiResponseToIR(
      baseResp({
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ functionCall: { name: 'get_weather', args: { city: '北京' } } }],
            },
            finishReason: 'STOP',
            index: 0,
          },
        ],
      }),
    )
    expect(ir.content).toEqual([
      { type: 'tool_use', id: 'gemini-get_weather', name: 'get_weather', input: { city: '北京' } },
    ])
  })

  it('finishReason MAX_TOKENS → max_tokens', () => {
    const ir = geminiResponseToIR(
      baseResp({
        candidates: [
          { content: { role: 'model', parts: [{ text: 'truncated' }] }, finishReason: 'MAX_TOKENS', index: 0 },
        ],
      }),
    )
    expect(ir.stopReason).toBe('max_tokens')
  })

  it('finishReason STOP → end_turn', () => {
    const ir = geminiResponseToIR(baseResp())
    expect(ir.stopReason).toBe('end_turn')
  })

  it('usageMetadata → inputTokens/outputTokens', () => {
    const ir = geminiResponseToIR(
      baseResp({
        usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 8, totalTokenCount: 28 },
      }),
    )
    expect(ir.usage).toEqual({ inputTokens: 20, outputTokens: 8 })
  })

  it('空 candidates → 空 content + end_turn + 零 usage', () => {
    const ir = geminiResponseToIR({
      candidates: [],
      usageMetadata: { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 },
    })
    expect(ir.content).toEqual([])
    expect(ir.stopReason).toBe('end_turn')
    expect(ir.usage).toEqual({ inputTokens: 0, outputTokens: 0 })
  })
})

// ─── Gemini SSE → IR 事件 ───────────────────────────────────────────────────

describe('createGeminiSseToEventsParser', () => {
  it('text part → text_delta', () => {
    const chunk = {
      candidates: [{ content: { role: 'model', parts: [{ text: '你好' }] } }],
    }
    const events = parseGeminiSse(sseData(chunk))
    expect(events).toContainEqual({ type: 'text_delta', text: '你好' })
  })

  it('多个 text chunks → 多个 text_delta', () => {
    const c1 = { candidates: [{ content: { role: 'model', parts: [{ text: '你' }] } }] }
    const c2 = { candidates: [{ content: { role: 'model', parts: [{ text: '好' }] } }] }
    const events = parseGeminiSse(sseData(c1) + sseData(c2))
    expect(events).toEqual([
      { type: 'text_delta', text: '你' },
      { type: 'text_delta', text: '好' },
    ])
  })

  it('functionCall part → tool_use_start + tool_use_delta（args JSON 完整）', () => {
    const chunk = {
      candidates: [
        {
          content: {
            role: 'model',
            parts: [{ functionCall: { name: 'search', args: { q: 'AI' } } }],
          },
        },
      ],
    }
    const events = parseGeminiSse(sseData(chunk))
    expect(events).toContainEqual({
      type: 'tool_use_start',
      index: 0,
      id: 'gemini-search',
      name: 'search',
    })
    expect(events).toContainEqual({
      type: 'tool_use_delta',
      index: 0,
      partialJson: JSON.stringify({ q: 'AI' }),
    })
  })

  it('两个 functionCall → 不同 index', () => {
    const chunk = {
      candidates: [
        {
          content: {
            role: 'model',
            parts: [
              { functionCall: { name: 'fn1', args: {} } },
              { functionCall: { name: 'fn2', args: { x: 1 } } },
            ],
          },
        },
      ],
    }
    const events = parseGeminiSse(sseData(chunk))
    const starts = events.filter((e) => e.type === 'tool_use_start') as Extract<CanonicalStreamEvent, { type: 'tool_use_start' }>[]
    expect(starts).toHaveLength(2)
    expect(starts[0].index).toBe(0)
    expect(starts[1].index).toBe(1)
    expect(starts[0].name).toBe('fn1')
    expect(starts[1].name).toBe('fn2')
  })

  it('finishReason 非空 → message_stop（stop 在前 usage 在后）', () => {
    const chunk = {
      candidates: [
        { content: { role: 'model', parts: [] }, finishReason: 'STOP' },
      ],
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3 },
    }
    const events = parseGeminiSse(sseData(chunk))
    const stopIdx = events.findIndex((e) => e.type === 'message_stop')
    const usageIdx = events.findIndex((e) => e.type === 'usage')
    expect(stopIdx).toBeGreaterThanOrEqual(0)
    expect(usageIdx).toBeGreaterThanOrEqual(0)
    expect(stopIdx).toBeLessThan(usageIdx) // stop 在 usage 前
    expect(events[stopIdx]).toEqual({ type: 'message_stop', stopReason: 'end_turn' })
    expect(events[usageIdx]).toEqual({ type: 'usage', usage: { inputTokens: 5, outputTokens: 3 } })
  })

  it('finishReason MAX_TOKENS → message_stop stopReason=max_tokens', () => {
    const chunk = {
      candidates: [{ content: { role: 'model', parts: [] }, finishReason: 'MAX_TOKENS' }],
    }
    const events = parseGeminiSse(sseData(chunk))
    expect(events).toContainEqual({ type: 'message_stop', stopReason: 'max_tokens' })
  })

  it('usageMetadata without finishReason → usage 事件（无 message_stop）', () => {
    const chunk = {
      candidates: [{ content: { role: 'model', parts: [{ text: 'x' }] } }],
      usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 2 },
    }
    const events = parseGeminiSse(sseData(chunk))
    expect(events).toContainEqual({ type: 'usage', usage: { inputTokens: 4, outputTokens: 2 } })
    expect(events.some((e) => e.type === 'message_stop')).toBe(false)
  })

  it('半帧跨 push：data 行被切两半，仍正确解析', () => {
    const parser = createGeminiSseToEventsParser()
    const full = sseData({ candidates: [{ content: { role: 'model', parts: [{ text: 'hello' }] } }] })
    const cut = Math.floor(full.length / 2)
    const a = parser.push(full.slice(0, cut))
    const b = parser.push(full.slice(cut))
    expect([...a, ...b]).toContainEqual({ type: 'text_delta', text: 'hello' })
  })

  it('畸形帧跳过，不影响后续', () => {
    const valid = sseData({ candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] } }] })
    const events = parseGeminiSse('data: {not json\n\n' + valid)
    expect(events).toContainEqual({ type: 'text_delta', text: 'ok' })
  })

  it('空 text part 跳过（不 emit text_delta）', () => {
    const chunk = {
      candidates: [{ content: { role: 'model', parts: [{ text: '' }] } }],
    }
    const events = parseGeminiSse(sseData(chunk))
    expect(events.some((e) => e.type === 'text_delta')).toBe(false)
  })
})

// ─── GeminiCodec 单测 ─────────────────────────────────────────────────────────

describe('GeminiCodec', () => {
  const codec = new GeminiCodec()

  it('protocol = "gemini"', () => {
    expect(codec.protocol).toBe('gemini')
  })

  it('endpointPath 非流式 → /models/{model}:generateContent', () => {
    const ir = { model: 'gemini-1.5-pro', messages: [], stream: false } as CanonicalRequest
    expect(codec.endpointPath(ir, false)).toBe('/models/gemini-1.5-pro:generateContent')
  })

  it('endpointPath 流式 → /models/{model}:streamGenerateContent?alt=sse', () => {
    const ir = { model: 'gemini-1.5-flash', messages: [], stream: false } as CanonicalRequest
    expect(codec.endpointPath(ir, true)).toBe('/models/gemini-1.5-flash:streamGenerateContent?alt=sse')
  })

  it('authHeaders → x-goog-api-key + content-type', () => {
    const headers = codec.authHeaders('AIza-test')
    expect(headers['x-goog-api-key']).toBe('AIza-test')
    expect(headers['content-type']).toBe('application/json')
    expect(headers['Authorization']).toBeUndefined()
  })

  it('renderRequest → body 不含 model/stream 字段', () => {
    const ir: CanonicalRequest = {
      model: 'gemini-1.5-pro',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      stream: false,
    }
    const body = codec.renderRequest(ir, false) as Record<string, unknown>
    expect(body['model']).toBeUndefined()
    expect(body['stream']).toBeUndefined()
    expect(Array.isArray(body['contents'])).toBe(true)
  })

  it('renderRequest 流式 → body 仍不含 stream 字段（靠 endpoint）', () => {
    const ir: CanonicalRequest = {
      model: 'gemini-1.5-pro',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      stream: false,
    }
    const body = codec.renderRequest(ir, true) as Record<string, unknown>
    expect(body['stream']).toBeUndefined()
  })

  it('createStreamParser() 返回含 push/flush 的解析器', () => {
    const parser = codec.createStreamParser()
    expect(typeof parser.push).toBe('function')
    expect(typeof parser.flush).toBe('function')
  })
})
