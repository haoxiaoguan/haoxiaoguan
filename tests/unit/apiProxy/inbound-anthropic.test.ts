import { describe, it, expect } from 'vitest'
import {
  anthropicToIR,
  irToAnthropicResponse,
  serializeAnthropicStream,
} from '../../../src/main/contexts/apiProxy/infrastructure/inbound/anthropic'

describe('anthropicToIR', () => {
  it('顶层 string system → IR system；user text block 透传', () => {
    const ir = anthropicToIR({
      model: 'claude-sonnet-4-5',
      system: 'be nice',
      max_tokens: 1024,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    })
    expect(ir.system).toBe('be nice')
    expect(ir.maxTokens).toBe(1024)
    expect(ir.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'hi' }] }])
    expect(ir.stream).toBe(false)
  })

  it('system block 数组以换行连接', () => {
    const ir = anthropicToIR({
      model: 'm',
      max_tokens: 1,
      system: [
        { type: 'text', text: 'a' },
        { type: 'text', text: 'b' },
      ],
      messages: [],
    })
    expect(ir.system).toBe('a\nb')
  })

  it('content string 归一化为单个 TextBlock', () => {
    const ir = anthropicToIR({ model: 'm', max_tokens: 1, messages: [{ role: 'user', content: 'plain' }] })
    expect(ir.messages[0].content).toEqual([{ type: 'text', text: 'plain' }])
  })

  it('image / tool_use / tool_result / thinking blocks 直传到 IR', () => {
    const ir = anthropicToIR({
      model: 'm',
      max_tokens: 1,
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'let me think', signature: 'sig1' },
            { type: 'text', text: 'answer' },
            { type: 'tool_use', id: 'tu_1', name: 'f', input: { a: 1 } },
          ],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'tu_1', content: [{ type: 'text', text: 'res' }] },
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'QQ==' } },
          ],
        },
      ],
    })
    expect(ir.messages[0].content).toEqual([
      { type: 'thinking', text: 'let me think', signature: 'sig1' },
      { type: 'text', text: 'answer' },
      { type: 'tool_use', id: 'tu_1', name: 'f', input: { a: 1 } },
    ])
    expect(ir.messages[1].content).toEqual([
      { type: 'tool_result', toolUseId: 'tu_1', content: [{ type: 'text', text: 'res' }] },
      { type: 'image', mediaType: 'image/jpeg', data: 'QQ==' },
    ])
  })

  it('tool_result content 为字符串时包成单个 TextBlock；is_error 透传', () => {
    const ir = anthropicToIR({
      model: 'm',
      max_tokens: 1,
      messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'boom', is_error: true }] }],
    })
    expect(ir.messages[0].content[0]).toEqual({
      type: 'tool_result',
      toolUseId: 't',
      content: [{ type: 'text', text: 'boom' }],
      isError: true,
    })
  })

  it('tools / tool_choice / thinking 映射', () => {
    const ir = anthropicToIR({
      model: 'm',
      max_tokens: 1,
      messages: [],
      tools: [{ name: 'f', description: 'do', input_schema: { type: 'object' } }],
      tool_choice: { type: 'tool', name: 'f' },
      thinking: { type: 'enabled', budget_tokens: 2048 },
    })
    expect(ir.tools).toEqual([{ name: 'f', description: 'do', inputSchema: { type: 'object' } }])
    expect(ir.toolChoice).toEqual({ type: 'tool', name: 'f' })
    expect(ir.thinking).toEqual({ type: 'enabled', budgetTokens: 2048 })
  })

  it('anthropicToIR 提取 cache_control 断点到 ir.cacheControl', () => {
    const ir = anthropicToIR({
      model: 'claude-sonnet-4.5',
      max_tokens: 100,
      system: [{ type: 'text', text: 'long system prompt', cache_control: { type: 'ephemeral' } }] as any,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    })
    expect(ir.cacheControl).toBeDefined()
    expect(ir.cacheControl && ir.cacheControl.length).toBeGreaterThan(0)
    expect(ir.cacheControl && ir.cacheControl[0].ttl).toBeGreaterThan(0)
  })

  it('无 cache_control 时 ir.cacheControl 为 undefined', () => {
    const ir = anthropicToIR({
      model: 'claude-sonnet-4.5',
      max_tokens: 100,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    })
    expect(ir.cacheControl).toBeUndefined()
  })
})

describe('irToAnthropicResponse', () => {
  it('content blocks 还原；stop_reason 同名直传；usage 映射', () => {
    const out = irToAnthropicResponse(
      {
        model: 'claude-sonnet-4-5',
        content: [
          { type: 'text', text: 'hi' },
          { type: 'tool_use', id: 'tu_1', name: 'f', input: { a: 1 } },
        ],
        stopReason: 'tool_use',
        usage: { inputTokens: 5, outputTokens: 3, cacheReadTokens: 2, cacheWriteTokens: 1 },
      },
      { id: 'msg_test' },
    )
    expect(out.id).toBe('msg_test')
    expect(out.type).toBe('message')
    expect(out.role).toBe('assistant')
    expect(out.model).toBe('claude-sonnet-4-5')
    expect(out.content).toEqual([
      { type: 'text', text: 'hi' },
      { type: 'tool_use', id: 'tu_1', name: 'f', input: { a: 1 } },
    ])
    expect(out.stop_reason).toBe('tool_use')
    expect(out.usage).toEqual({
      input_tokens: 5,
      output_tokens: 3,
      cache_read_input_tokens: 2,
      cache_creation_input_tokens: 1,
    })
  })

  it('thinking + image 块还原到 Anthropic 形态', () => {
    const out = irToAnthropicResponse(
      {
        model: 'm',
        content: [{ type: 'thinking', text: 'mmm', signature: 'sig' }],
        stopReason: 'end_turn',
        usage: { inputTokens: 1, outputTokens: 1 },
      },
      { id: 'x' },
    )
    expect(out.content[0]).toEqual({ type: 'thinking', thinking: 'mmm', signature: 'sig' })
  })
})

describe('serializeAnthropicStream', () => {
  // 解析 SSE：每帧两行 `event: X` + `data: {...}`。返回 [{ event, data }]。
  const parseEvents = (frames: string[]): { event: string; data: unknown }[] =>
    frames.map((f) => {
      const lines = f.trimEnd().split('\n')
      const event = lines[0].slice('event: '.length)
      const data = JSON.parse(lines[1].slice('data: '.length))
      return { event, data }
    })

  it('text 流：message_start→content_block_start→deltas→content_block_stop→message_delta→message_stop', () => {
    const resp: { model: string } = { model: 'm' }
    const frames = serializeAnthropicStream(
      { model: 'm', content: [], stopReason: 'end_turn', usage: { inputTokens: 4, outputTokens: 0 } },
      [
        { type: 'text_delta', text: 'He' },
        { type: 'text_delta', text: 'llo' },
        { type: 'usage', usage: { inputTokens: 4, outputTokens: 2 } },
        { type: 'message_stop', stopReason: 'end_turn' },
      ],
      { id: 'msg_s' },
    )
    void resp
    const events = parseEvents(frames)
    const seq = events.map((e) => e.event)
    expect(seq[0]).toBe('message_start')
    expect(seq).toContain('content_block_start')
    expect(seq).toContain('content_block_delta')
    expect(seq).toContain('content_block_stop')
    expect(seq).toContain('message_delta')
    expect(seq[seq.length - 1]).toBe('message_stop')

    // message_start 携带 id + role
    const start = events[0].data as { type: string; message: { id: string; role: string } }
    expect(start.message.id).toBe('msg_s')
    expect(start.message.role).toBe('assistant')

    // 文本增量帧
    const deltas = events
      .filter((e) => e.event === 'content_block_delta')
      .map((e) => (e.data as { delta: { type: string; text?: string } }).delta)
    expect(deltas.map((d) => d.text)).toEqual(['He', 'llo'])
    expect(deltas[0].type).toBe('text_delta')

    // message_delta 携带 stop_reason + output usage
    const msgDelta = events.find((e) => e.event === 'message_delta')!.data as {
      delta: { stop_reason: string }
      usage: { output_tokens: number }
    }
    expect(msgDelta.delta.stop_reason).toBe('end_turn')
    expect(msgDelta.usage.output_tokens).toBe(2)
  })

  it('tool_use 流：content_block_start(tool_use) + input_json_delta', () => {
    const frames = serializeAnthropicStream(
      { model: 'm', content: [], stopReason: 'tool_use', usage: { inputTokens: 1, outputTokens: 1 } },
      [
        { type: 'tool_use_start', index: 0, id: 'tu_1', name: 'get_weather' },
        { type: 'tool_use_delta', index: 0, partialJson: '{"city":"SF"}' },
        { type: 'message_stop', stopReason: 'tool_use' },
      ],
      { id: 'x' },
    )
    const events = parseEvents(frames)
    const cbStart = events.find((e) => e.event === 'content_block_start')!.data as {
      index: number
      content_block: { type: string; id: string; name: string }
    }
    expect(cbStart.content_block).toEqual({ type: 'tool_use', id: 'tu_1', name: 'get_weather', input: {} })
    const jsonDelta = events
      .filter((e) => e.event === 'content_block_delta')
      .map((e) => (e.data as { delta: { type: string; partial_json?: string } }).delta)[0]
    expect(jsonDelta).toEqual({ type: 'input_json_delta', partial_json: '{"city":"SF"}' })
  })
})
