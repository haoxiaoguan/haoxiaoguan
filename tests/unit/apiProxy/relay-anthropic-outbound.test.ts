// T3：第三方中转 Anthropic Messages 出站镜像转换器测试。
// 验证 IR→上游请求、上游响应→IR、上游 SSE→IR 三方向 + 黄金往返（与 inbound 序列化的往返一致性）。
import { describe, it, expect } from 'vitest'
import type {
  CanonicalRequest,
  CanonicalResponse,
  CanonicalStreamEvent,
} from '../../../src/main/contexts/apiProxy/domain/canonical'
import {
  serializeAnthropicStream,
  type AnthropicMessage,
} from '../../../src/main/contexts/apiProxy/infrastructure/inbound/anthropic'
import {
  irToAnthropicRequest,
  anthropicResponseToIR,
  createAnthropicSseToEventsParser,
  parseAnthropicSse,
} from '../../../src/main/contexts/apiProxy/infrastructure/adapters/relay/anthropic-outbound'

// ─── helpers ──────────────────────────────────────────────────────────────────

/** 把 Anthropic SSE 帧对象序列化成一条 SSE 帧字符串（event: + data: 双行）。 */
function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

// ─── IR → Anthropic 请求体 ────────────────────────────────────────────────────
describe('irToAnthropicRequest', () => {
  it('system + 单 user 文本', () => {
    const ir: CanonicalRequest = {
      model: 'claude-3-5-sonnet-20241022',
      system: '你是助手',
      messages: [{ role: 'user', content: [{ type: 'text', text: '你好' }] }],
      stream: false,
    }
    const out = irToAnthropicRequest(ir)
    expect(out.model).toBe('claude-3-5-sonnet-20241022')
    expect(out.system).toBe('你是助手')
    expect(out.messages[0]).toEqual({ role: 'user', content: [{ type: 'text', text: '你好' }] })
    expect(out.stream).toBe(false)
  })

  it('无 system 时省略 system 字段', () => {
    const out = irToAnthropicRequest({ model: 'm', messages: [], stream: false })
    expect(out.system).toBeUndefined()
  })

  it('max_tokens：IR 有值时透传；IR 无值时给默认 4096', () => {
    expect(irToAnthropicRequest({ model: 'm', messages: [], stream: false, maxTokens: 1000 }).max_tokens).toBe(1000)
    expect(irToAnthropicRequest({ model: 'm', messages: [], stream: false }).max_tokens).toBe(4096)
  })

  it('temperature / top_p 透传', () => {
    const out = irToAnthropicRequest({
      model: 'm',
      messages: [],
      stream: false,
      temperature: 0.7,
      topP: 0.9,
    })
    expect(out.temperature).toBe(0.7)
    expect(out.top_p).toBe(0.9)
  })

  it('assistant 消息含 tool_use → Anthropic tool_use block', () => {
    const out = irToAnthropicRequest({
      model: 'm',
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'tu_1', name: 'get_weather', input: { city: '北京' } }],
        },
      ],
      stream: false,
    })
    const block = out.messages[0].content
    expect(Array.isArray(block)).toBe(true)
    expect((block as { type: string }[])[0]).toEqual({
      type: 'tool_use',
      id: 'tu_1',
      name: 'get_weather',
      input: { city: '北京' },
    })
  })

  it('user 消息含 tool_result → Anthropic tool_result block', () => {
    const out = irToAnthropicRequest({
      model: 'm',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              toolUseId: 'tu_1',
              content: [{ type: 'text', text: '晴' }],
            },
          ],
        },
      ],
      stream: false,
    })
    const block = (out.messages[0].content as { type: string; tool_use_id?: string; content?: unknown }[])[0]
    expect(block.type).toBe('tool_result')
    expect(block.tool_use_id).toBe('tu_1')
    expect(block.content).toEqual([{ type: 'text', text: '晴' }])
  })

  it('tool_result isError 透传', () => {
    const out = irToAnthropicRequest({
      model: 'm',
      messages: [
        {
          role: 'user',
          content: [{ type: 'tool_result', toolUseId: 'x', content: [{ type: 'text', text: 'err' }], isError: true }],
        },
      ],
      stream: false,
    })
    const block = (out.messages[0].content as { is_error?: boolean }[])[0]
    expect(block.is_error).toBe(true)
  })

  it('tools / input_schema 映射', () => {
    const out = irToAnthropicRequest({
      model: 'm',
      messages: [],
      stream: false,
      tools: [{ name: 'f', description: 'desc', inputSchema: { type: 'object', properties: {} } }],
    })
    expect(out.tools).toEqual([{ name: 'f', description: 'desc', input_schema: { type: 'object', properties: {} } }])
  })

  it('无 description 时省略 description', () => {
    const out = irToAnthropicRequest({
      model: 'm',
      messages: [],
      stream: false,
      tools: [{ name: 'f', inputSchema: {} }],
    })
    expect(out.tools?.[0].description).toBeUndefined()
  })

  it('tool_choice: auto/any/none/tool 透传', () => {
    expect(irToAnthropicRequest({ model: 'm', messages: [], stream: false, toolChoice: { type: 'auto' } }).tool_choice).toEqual({ type: 'auto' })
    expect(irToAnthropicRequest({ model: 'm', messages: [], stream: false, toolChoice: { type: 'any' } }).tool_choice).toEqual({ type: 'any' })
    expect(irToAnthropicRequest({ model: 'm', messages: [], stream: false, toolChoice: { type: 'none' } }).tool_choice).toEqual({ type: 'none' })
    expect(irToAnthropicRequest({ model: 'm', messages: [], stream: false, toolChoice: { type: 'tool', name: 'f' } }).tool_choice).toEqual({ type: 'tool', name: 'f' })
  })

  it('image 块 → Anthropic base64 source', () => {
    const out = irToAnthropicRequest({
      model: 'm',
      messages: [{ role: 'user', content: [{ type: 'image', mediaType: 'image/png', data: 'AAAA' }] }],
      stream: false,
    })
    const block = (out.messages[0].content as { type: string; source?: { type: string; media_type: string; data: string } }[])[0]
    expect(block.type).toBe('image')
    expect(block.source).toEqual({ type: 'base64', media_type: 'image/png', data: 'AAAA' })
  })

  it('thinking enabled → thinking 字段', () => {
    const out = irToAnthropicRequest({
      model: 'm',
      messages: [],
      stream: false,
      thinking: { type: 'enabled', budgetTokens: 1024 },
    })
    expect(out.thinking).toEqual({ type: 'enabled', budget_tokens: 1024 })
  })

  it('thinking disabled → thinking 字段', () => {
    const out = irToAnthropicRequest({
      model: 'm',
      messages: [],
      stream: false,
      thinking: { type: 'disabled' },
    })
    expect(out.thinking).toEqual({ type: 'disabled' })
  })
})

// ─── Anthropic 响应 → IR ──────────────────────────────────────────────────────
describe('anthropicResponseToIR', () => {
  const base = (over: Partial<AnthropicMessage> = {}): AnthropicMessage => ({
    id: 'msg_01',
    type: 'message',
    role: 'assistant',
    model: 'claude-3-5-sonnet-20241022',
    content: [{ type: 'text', text: '你好' }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
    ...over,
  })

  it('文本响应 → text 块 + end_turn + usage', () => {
    const ir = anthropicResponseToIR(base())
    expect(ir.content).toEqual([{ type: 'text', text: '你好' }])
    expect(ir.stopReason).toBe('end_turn')
    expect(ir.usage).toEqual({ inputTokens: 10, outputTokens: 5 })
    expect(ir.model).toBe('claude-3-5-sonnet-20241022')
  })

  it('tool_use 响应 → tool_use 块', () => {
    const ir = anthropicResponseToIR(
      base({
        content: [{ type: 'tool_use', id: 'tu_1', name: 'get_weather', input: { city: '北京' } }],
        stop_reason: 'tool_use',
      }),
    )
    expect(ir.content).toEqual([{ type: 'tool_use', id: 'tu_1', name: 'get_weather', input: { city: '北京' } }])
    expect(ir.stopReason).toBe('tool_use')
  })

  it('thinking 块', () => {
    const ir = anthropicResponseToIR(
      base({
        content: [
          { type: 'thinking', thinking: '让我想想', signature: 'sig_abc' },
          { type: 'text', text: '结论' },
        ],
      }),
    )
    expect(ir.content[0]).toEqual({ type: 'thinking', text: '让我想想', signature: 'sig_abc' })
    expect(ir.content[1]).toEqual({ type: 'text', text: '结论' })
  })

  it('thinking 块无 signature 时不含 signature 字段', () => {
    const ir = anthropicResponseToIR(
      base({ content: [{ type: 'thinking', thinking: '思考中' }] }),
    )
    expect((ir.content[0] as { signature?: string }).signature).toBeUndefined()
  })

  it('stop_reason 各值映射', () => {
    expect(anthropicResponseToIR(base({ stop_reason: 'end_turn' })).stopReason).toBe('end_turn')
    expect(anthropicResponseToIR(base({ stop_reason: 'max_tokens' })).stopReason).toBe('max_tokens')
    expect(anthropicResponseToIR(base({ stop_reason: 'tool_use' })).stopReason).toBe('tool_use')
    expect(anthropicResponseToIR(base({ stop_reason: 'stop_sequence' })).stopReason).toBe('stop_sequence')
  })

  it('usage：含 cache_read_input_tokens + cache_creation_input_tokens', () => {
    const ir = anthropicResponseToIR(
      base({
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_read_input_tokens: 30,
          cache_creation_input_tokens: 20,
        },
      }),
    )
    expect(ir.usage).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 30,
      cacheWriteTokens: 20,
    })
  })

  it('usage：无 cache 字段时 cacheReadTokens/cacheWriteTokens undefined', () => {
    const ir = anthropicResponseToIR(base())
    expect(ir.usage.cacheReadTokens).toBeUndefined()
    expect(ir.usage.cacheWriteTokens).toBeUndefined()
  })
})

// ─── Anthropic SSE → IR 事件 ──────────────────────────────────────────────────
describe('createAnthropicSseToEventsParser', () => {
  it('文本流：message_start + text_delta → text_delta 事件', () => {
    const sse =
      frame('message_start', { type: 'message_start', message: { usage: { input_tokens: 10 } } }) +
      frame('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text' } }) +
      frame('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '你' } }) +
      frame('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '好' } }) +
      frame('content_block_stop', { type: 'content_block_stop', index: 0 }) +
      frame('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } }) +
      frame('message_stop', { type: 'message_stop' })

    const events = parseAnthropicSse(sse)
    expect(events).toContainEqual({ type: 'text_delta', text: '你' })
    expect(events).toContainEqual({ type: 'text_delta', text: '好' })
    expect(events).toContainEqual({ type: 'message_stop', stopReason: 'end_turn' })
    expect(events).toContainEqual({ type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } })
  })

  it('tool_use 流：content_block_start(tool_use) → tool_use_start；input_json_delta → tool_use_delta', () => {
    const sse =
      frame('message_start', { type: 'message_start', message: { usage: { input_tokens: 20 } } }) +
      frame('content_block_start', {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'tu_1', name: 'get_weather' },
      }) +
      frame('content_block_delta', {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"city":' },
      }) +
      frame('content_block_delta', {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '"北京"}' },
      }) +
      frame('content_block_stop', { type: 'content_block_stop', index: 0 }) +
      frame('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: 'tool_use', stop_sequence: null },
        usage: { output_tokens: 15 },
      }) +
      frame('message_stop', { type: 'message_stop' })

    const events = parseAnthropicSse(sse)
    expect(events[0]).toEqual({ type: 'tool_use_start', index: 0, id: 'tu_1', name: 'get_weather' })
    expect(events[1]).toEqual({ type: 'tool_use_delta', index: 0, partialJson: '{"city":' })
    expect(events[2]).toEqual({ type: 'tool_use_delta', index: 0, partialJson: '"北京"}' })
    expect(events[3]).toEqual({ type: 'message_stop', stopReason: 'tool_use' })
    expect(events[4]).toEqual({ type: 'usage', usage: { inputTokens: 20, outputTokens: 15 } })
  })

  it('thinking 流：thinking_delta → thinking_delta 事件', () => {
    const sse =
      frame('message_start', { type: 'message_start', message: { usage: { input_tokens: 5 } } }) +
      frame('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } }) +
      frame('content_block_delta', {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: '让我想想' },
      }) +
      frame('content_block_stop', { type: 'content_block_stop', index: 0 }) +
      frame('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: 8 },
      }) +
      frame('message_stop', { type: 'message_stop' })

    const events = parseAnthropicSse(sse)
    expect(events).toContainEqual({ type: 'thinking_delta', text: '让我想想' })
  })

  it('signature_delta → 忽略（不 emit 事件）', () => {
    const sse =
      frame('content_block_delta', {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'signature_delta', signature: 'sigblob' },
      })
    const events = parseAnthropicSse(sse)
    expect(events.length).toBe(0)
  })

  it('message_delta → message_stop 在前，usage 在后', () => {
    const sse =
      frame('message_start', { type: 'message_start', message: { usage: { input_tokens: 3 } } }) +
      frame('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: 'max_tokens', stop_sequence: null },
        usage: { output_tokens: 7 },
      })

    const events = parseAnthropicSse(sse)
    const stopIdx = events.findIndex((e) => e.type === 'message_stop')
    const usageIdx = events.findIndex((e) => e.type === 'usage')
    expect(stopIdx).toBeGreaterThanOrEqual(0)
    expect(usageIdx).toBeGreaterThanOrEqual(0)
    expect(stopIdx).toBeLessThan(usageIdx)
    expect(events[stopIdx]).toEqual({ type: 'message_stop', stopReason: 'max_tokens' })
    expect(events[usageIdx]).toEqual({ type: 'usage', usage: { inputTokens: 3, outputTokens: 7 } })
  })

  it('ping 帧 → 无事件', () => {
    const sse = frame('ping', { type: 'ping' })
    expect(parseAnthropicSse(sse)).toEqual([])
  })

  it('content_block_stop → 无事件', () => {
    const sse = frame('content_block_stop', { type: 'content_block_stop', index: 0 })
    expect(parseAnthropicSse(sse)).toEqual([])
  })

  it('message_stop 帧（data: {type:"message_stop"}）→ 无事件（已由 message_delta 处理）', () => {
    const sse = frame('message_stop', { type: 'message_stop' })
    expect(parseAnthropicSse(sse)).toEqual([])
  })

  it('半帧跨 push：一条 data 行被切两半，仍正确解析', () => {
    const parser = createAnthropicSseToEventsParser()
    const full = frame('content_block_delta', {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'hello' },
    })
    const cut = Math.floor(full.length / 2)
    const a = parser.push(full.slice(0, cut))
    const b = parser.push(full.slice(cut))
    expect([...a, ...b]).toContainEqual({ type: 'text_delta', text: 'hello' })
  })

  it('畸形 JSON 帧跳过，不影响后续', () => {
    const sse =
      'event: content_block_delta\ndata: {not json\n\n' +
      frame('content_block_delta', {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'ok' },
      })
    const events = parseAnthropicSse(sse)
    expect(events).toContainEqual({ type: 'text_delta', text: 'ok' })
  })

  it('event: 行（非 data: 行）被跳过，不影响解析', () => {
    // event: 行单独不会产生任何事件；data: 行 JSON 中的 type 字段才是判据。
    const sse =
      'event: content_block_delta\n' +
      `data: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hi' } })}\n\n`
    const events = parseAnthropicSse(sse)
    expect(events).toContainEqual({ type: 'text_delta', text: 'hi' })
  })

  it('多个 content block：index 对齐', () => {
    const sse =
      frame('message_start', { type: 'message_start', message: { usage: { input_tokens: 5 } } }) +
      frame('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu_0', name: 'fn_a' } }) +
      frame('content_block_stop', { type: 'content_block_stop', index: 0 }) +
      frame('content_block_start', { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tu_1', name: 'fn_b' } }) +
      frame('content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{}' } }) +
      frame('content_block_stop', { type: 'content_block_stop', index: 1 }) +
      frame('message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 3 } }) +
      frame('message_stop', { type: 'message_stop' })

    const events = parseAnthropicSse(sse)
    const start0 = events.find((e) => e.type === 'tool_use_start' && (e as { index: number }).index === 0)
    const start1 = events.find((e) => e.type === 'tool_use_start' && (e as { index: number }).index === 1)
    expect(start0).toEqual({ type: 'tool_use_start', index: 0, id: 'tu_0', name: 'fn_a' })
    expect(start1).toEqual({ type: 'tool_use_start', index: 1, id: 'tu_1', name: 'fn_b' })
    expect(events).toContainEqual({ type: 'tool_use_delta', index: 1, partialJson: '{}' })
  })

  // ─── 黄金往返 ──────────────────────────────────────────────────────────────

  it('黄金往返(text-only)：serializeAnthropicStream → parseAnthropicSse → 语义等价', () => {
    const resp: CanonicalResponse = {
      model: 'claude-3-5-sonnet-20241022',
      content: [],
      stopReason: 'end_turn',
      usage: { inputTokens: 10, outputTokens: 5 },
    }
    const irEvents: CanonicalStreamEvent[] = [
      { type: 'text_delta', text: '你' },
      { type: 'text_delta', text: '好' },
      { type: 'message_stop', stopReason: 'end_turn' },
      { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
    ]
    const frames = serializeAnthropicStream(resp, irEvents, { id: 'msg_x' })
    const back = parseAnthropicSse(frames.join(''))

    // 语义检查：回收到相同的文本 delta 和停止事件
    expect(back).toContainEqual({ type: 'text_delta', text: '你' })
    expect(back).toContainEqual({ type: 'text_delta', text: '好' })
    expect(back).toContainEqual({ type: 'message_stop', stopReason: 'end_turn' })
    // usage 事件（inputTokens 来自 message_start 记录的值，outputTokens 来自 message_delta）
    const usageEv = back.find((e) => e.type === 'usage') as { type: 'usage'; usage: { inputTokens: number; outputTokens: number } } | undefined
    expect(usageEv).toBeDefined()
    expect(usageEv!.usage.outputTokens).toBe(5)
  })

  it('黄金往返(tool_use)：serializeAnthropicStream → parseAnthropicSse → 语义等价', () => {
    const resp: CanonicalResponse = {
      model: 'claude-3-5-sonnet-20241022',
      content: [],
      stopReason: 'tool_use',
      usage: { inputTokens: 20, outputTokens: 10 },
    }
    const irEvents: CanonicalStreamEvent[] = [
      { type: 'tool_use_start', index: 0, id: 'tu_1', name: 'get_weather' },
      { type: 'tool_use_delta', index: 0, partialJson: '{"city":' },
      { type: 'tool_use_delta', index: 0, partialJson: '"北京"}' },
      { type: 'message_stop', stopReason: 'tool_use' },
      { type: 'usage', usage: { inputTokens: 20, outputTokens: 10 } },
    ]
    const frames = serializeAnthropicStream(resp, irEvents, { id: 'msg_y' })
    const back = parseAnthropicSse(frames.join(''))

    expect(back).toContainEqual({ type: 'tool_use_start', index: 0, id: 'tu_1', name: 'get_weather' })
    expect(back).toContainEqual({ type: 'tool_use_delta', index: 0, partialJson: '{"city":' })
    expect(back).toContainEqual({ type: 'tool_use_delta', index: 0, partialJson: '"北京"}' })
    expect(back).toContainEqual({ type: 'message_stop', stopReason: 'tool_use' })
    const usageEv = back.find((e) => e.type === 'usage') as { type: 'usage'; usage: { inputTokens: number; outputTokens: number } } | undefined
    expect(usageEv).toBeDefined()
    expect(usageEv!.usage.outputTokens).toBe(10)
  })
})
