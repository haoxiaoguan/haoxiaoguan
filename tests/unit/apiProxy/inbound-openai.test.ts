import { describe, it, expect } from 'vitest'
import { openaiToIR, irToOpenAIResponse, serializeOpenAIStream } from '../../../src/main/contexts/apiProxy/infrastructure/inbound/openai'

describe('openaiToIR', () => {
  it('收敛 system 消息为 system 字段，user 文本归一化为 TextBlock，并带参数', () => {
    const ir = openaiToIR({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'be concise' },
        { role: 'user', content: 'hello' },
      ],
      max_tokens: 256,
      temperature: 0.7,
      top_p: 0.9,
      stream: true,
    })
    expect(ir.model).toBe('gpt-4o')
    expect(ir.system).toBe('be concise')
    expect(ir.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'hello' }] }])
    expect(ir.maxTokens).toBe(256)
    expect(ir.temperature).toBe(0.7)
    expect(ir.topP).toBe(0.9)
    expect(ir.stream).toBe(true)
  })

  it('stream 缺省归一化为 false', () => {
    const ir = openaiToIR({ model: 'm', messages: [{ role: 'user', content: 'hi' }] })
    expect(ir.stream).toBe(false)
  })

  it('多段 system 消息以换行连接', () => {
    const ir = openaiToIR({
      model: 'm',
      messages: [
        { role: 'system', content: 'line1' },
        { role: 'system', content: 'line2' },
        { role: 'user', content: 'q' },
      ],
    })
    expect(ir.system).toBe('line1\nline2')
  })

  it('assistant.tool_calls 转 ToolUseBlock，arguments JSON 被 parse 成对象', () => {
    const ir = openaiToIR({
      model: 'm',
      messages: [
        { role: 'user', content: 'weather?' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            { id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"SF"}' } },
          ],
        },
      ],
    })
    expect(ir.messages[1]).toEqual({
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'call_1', name: 'get_weather', input: { city: 'SF' } }],
    })
  })

  it('非法 arguments JSON 回退为空对象', () => {
    const ir = openaiToIR({
      model: 'm',
      messages: [
        { role: 'assistant', content: null, tool_calls: [{ id: 'c', type: 'function', function: { name: 'f', arguments: 'not-json' } }] },
      ],
    })
    expect((ir.messages[0].content[0] as { input: unknown }).input).toEqual({})
  })

  it('role:tool 消息归并为后随 user 消息内的 ToolResultBlock', () => {
    const ir = openaiToIR({
      model: 'm',
      messages: [
        { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'f', arguments: '{}' } }] },
        { role: 'tool', tool_call_id: 'call_1', content: 'sunny' },
        { role: 'user', content: 'thanks' },
      ],
    })
    // assistant 在前；tool + 后续 user 文本合并成一条 user 消息
    expect(ir.messages[0].role).toBe('assistant')
    expect(ir.messages[1]).toEqual({
      role: 'user',
      content: [
        { type: 'tool_result', toolUseId: 'call_1', content: [{ type: 'text', text: 'sunny' }] },
        { type: 'text', text: 'thanks' },
      ],
    })
  })

  it('image_url data URL 转 ImageBlock（剥离 data: 前缀）', () => {
    const ir = openaiToIR({
      model: 'm',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'look' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } },
          ],
        },
      ],
    })
    expect(ir.messages[0].content).toEqual([
      { type: 'text', text: 'look' },
      { type: 'image', mediaType: 'image/png', data: 'QUJD' },
    ])
  })

  it('tools 转 ToolDef、tool_choice 转 ToolChoice', () => {
    const ir = openaiToIR({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ type: 'function', function: { name: 'f', description: 'do f', parameters: { type: 'object' } } }],
      tool_choice: { type: 'function', function: { name: 'f' } },
    })
    expect(ir.tools).toEqual([{ name: 'f', description: 'do f', inputSchema: { type: 'object' } }])
    expect(ir.toolChoice).toEqual({ type: 'tool', name: 'f' })
  })

  it('tool_choice 字面量 required → any、none → none', () => {
    expect(openaiToIR({ model: 'm', messages: [], tool_choice: 'required' }).toolChoice).toEqual({ type: 'any' })
    expect(openaiToIR({ model: 'm', messages: [], tool_choice: 'none' }).toolChoice).toEqual({ type: 'none' })
  })
})

describe('irToOpenAIResponse', () => {
  it('text 响应 → choices[0].message.content，stopReason end_turn → finish_reason stop', () => {
    const out = irToOpenAIResponse(
      {
        model: 'gpt-4o',
        content: [{ type: 'text', text: 'hello there' }],
        stopReason: 'end_turn',
        usage: { inputTokens: 5, outputTokens: 3 },
      },
      { id: 'chatcmpl-test', created: 1700000000 },
    )
    expect(out.id).toBe('chatcmpl-test')
    expect(out.object).toBe('chat.completion')
    expect(out.created).toBe(1700000000)
    expect(out.model).toBe('gpt-4o')
    expect(out.choices[0].message.content).toBe('hello there')
    expect(out.choices[0].message.tool_calls).toBeUndefined()
    expect(out.choices[0].finish_reason).toBe('stop')
    expect(out.usage).toEqual({ prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 })
  })

  it('tool_use 响应 → tool_calls（input 被 stringify），finish_reason tool_calls', () => {
    const out = irToOpenAIResponse(
      {
        model: 'm',
        content: [{ type: 'tool_use', id: 'call_1', name: 'get_weather', input: { city: 'SF' } }],
        stopReason: 'tool_use',
        usage: { inputTokens: 1, outputTokens: 1 },
      },
      { id: 'x', created: 0 },
    )
    expect(out.choices[0].message.content).toBeNull()
    expect(out.choices[0].message.tool_calls).toEqual([
      { id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"SF"}' } },
    ])
    expect(out.choices[0].finish_reason).toBe('tool_calls')
  })

  it('max_tokens → length；cacheReadTokens → prompt_tokens_details.cached_tokens', () => {
    const out = irToOpenAIResponse(
      { model: 'm', content: [{ type: 'text', text: 'x' }], stopReason: 'max_tokens', usage: { inputTokens: 10, outputTokens: 2, cacheReadTokens: 4 } },
      { id: 'x', created: 0 },
    )
    expect(out.choices[0].finish_reason).toBe('length')
    expect(out.usage.prompt_tokens_details).toEqual({ cached_tokens: 4 })
  })
})

describe('serializeOpenAIStream', () => {
  // 把 SSE 帧数组里每条 data: 行的 JSON 解析出来，便于逐帧断言。
  const parseFrames = (frames: string[]): unknown[] =>
    frames
      .filter((f) => f.startsWith('data: ') && !f.includes('[DONE]'))
      .map((f) => JSON.parse(f.slice('data: '.length).trim()))

  it('首帧带 role，随后文本增量，末帧 finish_reason 收尾，最后 [DONE]', () => {
    const frames = serializeOpenAIStream(
      [
        { type: 'text_delta', text: 'Hel' },
        { type: 'text_delta', text: 'lo' },
        { type: 'message_stop', stopReason: 'end_turn' },
      ],
      'gpt-4o',
      { id: 'chatcmpl-s', created: 1700000000 },
    )
    // 每帧都是 SSE 格式
    for (const f of frames) expect(f.endsWith('\n\n')).toBe(true)
    // 最后一帧是 [DONE]
    expect(frames[frames.length - 1]).toBe('data: [DONE]\n\n')

    const parsed = parseFrames(frames) as Array<{
      object: string
      choices: { delta: { role?: string; content?: string }; finish_reason: string | null }[]
    }>
    // 首帧含 role
    expect(parsed[0].object).toBe('chat.completion.chunk')
    expect(parsed[0].choices[0].delta.role).toBe('assistant')
    // 文本增量帧
    expect(parsed.map((p) => p.choices[0].delta.content).filter(Boolean)).toEqual(['Hel', 'lo'])
    // 收尾帧 finish_reason=stop 且 delta 空
    const last = parsed[parsed.length - 1]
    expect(last.choices[0].finish_reason).toBe('stop')
  })

  it('tool_use_start + tool_use_delta → tool_calls 流式帧', () => {
    const frames = serializeOpenAIStream(
      [
        { type: 'tool_use_start', index: 0, id: 'call_1', name: 'get_weather' },
        { type: 'tool_use_delta', index: 0, partialJson: '{"city":' },
        { type: 'tool_use_delta', index: 0, partialJson: '"SF"}' },
        { type: 'message_stop', stopReason: 'tool_use' },
      ],
      'm',
      { id: 'x', created: 0 },
    )
    const parsed = parseFrames(frames) as Array<{
      choices: { delta: { tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[] }; finish_reason: string | null }[]
    }>
    // start 帧带 id + name + 空 arguments
    const startFrame = parsed.find((p) => p.choices[0].delta.tool_calls?.[0]?.id === 'call_1')
    expect(startFrame?.choices[0].delta.tool_calls?.[0].function?.name).toBe('get_weather')
    // delta 帧带 arguments 片段
    const argChunks = parsed
      .map((p) => p.choices[0].delta.tool_calls?.[0]?.function?.arguments)
      .filter((a): a is string => typeof a === 'string')
    expect(argChunks).toEqual(['{"city":', '"SF"}'])
    // 收尾 finish_reason=tool_calls
    expect(parsed[parsed.length - 1].choices[0].finish_reason).toBe('tool_calls')
  })

  it('usage 事件透传为带 usage 字段的帧（include_usage 风格）', () => {
    const frames = serializeOpenAIStream(
      [
        { type: 'text_delta', text: 'x' },
        { type: 'usage', usage: { inputTokens: 7, outputTokens: 2 } },
        { type: 'message_stop', stopReason: 'end_turn' },
      ],
      'm',
      { id: 'x', created: 0 },
    )
    const parsed = parseFrames(frames) as Array<{ usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number } }>
    const usageFrame = parsed.find((p) => p.usage)
    expect(usageFrame?.usage).toEqual({ prompt_tokens: 7, completion_tokens: 2, total_tokens: 9 })
  })
})
