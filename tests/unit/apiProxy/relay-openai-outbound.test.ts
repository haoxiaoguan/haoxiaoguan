// R0:第三方中转 OpenAI Chat 出站镜像转换器测试。
// 验证 IR→上游请求、上游响应→IR、上游 SSE→IR 三方向 + 与 inbound 入站对的往返一致。
import { describe, it, expect } from 'vitest'
import type {
  CanonicalRequest,
  CanonicalResponse,
  CanonicalStreamEvent,
} from '../../../src/main/contexts/apiProxy/domain/canonical'
import {
  openaiToIR,
  irToOpenAIResponse,
  serializeOpenAIStream,
  type OpenAIChatRequest,
  type OpenAIChatCompletion,
} from '../../../src/main/contexts/apiProxy/infrastructure/inbound/openai'
import {
  irToOpenAIChatRequest,
  openAIChatResponseToIR,
  createOpenAiSseToEventsParser,
  parseOpenAiSse,
} from '../../../src/main/contexts/apiProxy/infrastructure/adapters/relay/openai-outbound'

// ─── IR → OpenAI 请求 ───────────────────────────────────────────────
describe('irToOpenAIChatRequest', () => {
  it('system + 单 user 文本 → system/user 消息', () => {
    const ir: CanonicalRequest = {
      model: 'deepseek-chat',
      system: '你是助手',
      messages: [{ role: 'user', content: [{ type: 'text', text: '你好' }] }],
      stream: false,
    }
    const out = irToOpenAIChatRequest(ir)
    expect(out.model).toBe('deepseek-chat')
    expect(out.messages[0]).toEqual({ role: 'system', content: '你是助手' })
    expect(out.messages[1]).toEqual({ role: 'user', content: '你好' })
    expect(out.stream).toBe(false)
    expect(out.stream_options).toBeUndefined()
  })

  it('stream=true → 附 stream_options.include_usage', () => {
    const out = irToOpenAIChatRequest({ model: 'm', messages: [], stream: true })
    expect(out.stream).toBe(true)
    expect(out.stream_options).toEqual({ include_usage: true })
  })

  it('user 内 tool_result 拆回独立 role:tool 消息(置于 user 之前)', () => {
    const ir: CanonicalRequest = {
      model: 'm',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'tool_result', toolUseId: 'call_1', content: [{ type: 'text', text: '42' }] },
            { type: 'text', text: '继续' },
          ],
        },
      ],
      stream: false,
    }
    const out = irToOpenAIChatRequest(ir)
    expect(out.messages[0]).toEqual({ role: 'tool', tool_call_id: 'call_1', content: '42' })
    expect(out.messages[1]).toEqual({ role: 'user', content: '继续' })
  })

  it('assistant tool_use → tool_calls;无文本时 content=null', () => {
    const out = irToOpenAIChatRequest({
      model: 'm',
      messages: [
        { role: 'assistant', content: [{ type: 'tool_use', id: 'call_1', name: 'get_weather', input: { city: '北京' } }] },
      ],
      stream: false,
    })
    const a = out.messages[0]
    expect(a.role).toBe('assistant')
    expect(a.content).toBeNull()
    expect(a.tool_calls).toEqual([
      { id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"北京"}' } },
    ])
  })

  it('tools / tool_choice / 标量映射', () => {
    const out = irToOpenAIChatRequest({
      model: 'm',
      messages: [],
      stream: false,
      maxTokens: 100,
      temperature: 0.5,
      topP: 0.9,
      tools: [{ name: 'f', description: 'desc', inputSchema: { type: 'object' } }],
      toolChoice: { type: 'tool', name: 'f' },
    })
    expect(out.max_tokens).toBe(100)
    expect(out.temperature).toBe(0.5)
    expect(out.top_p).toBe(0.9)
    expect(out.tools).toEqual([{ type: 'function', function: { name: 'f', description: 'desc', parameters: { type: 'object' } } }])
    expect(out.tool_choice).toEqual({ type: 'function', function: { name: 'f' } })
  })

  it('toolChoice any→required / none→none / auto→auto', () => {
    expect(irToOpenAIChatRequest({ model: 'm', messages: [], stream: false, toolChoice: { type: 'any' } }).tool_choice).toBe('required')
    expect(irToOpenAIChatRequest({ model: 'm', messages: [], stream: false, toolChoice: { type: 'none' } }).tool_choice).toBe('none')
    expect(irToOpenAIChatRequest({ model: 'm', messages: [], stream: false, toolChoice: { type: 'auto' } }).tool_choice).toBe('auto')
  })

  it('image 块 → data URL', () => {
    const out = irToOpenAIChatRequest({
      model: 'm',
      messages: [{ role: 'user', content: [{ type: 'image', mediaType: 'image/png', data: 'AAAA' }] }],
      stream: false,
    })
    expect(out.messages[0].content).toEqual([{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }])
  })

  it('往返:openaiToIR → irToOpenAIChatRequest 语义等价(含 assistant tool_calls + tool 结果)', () => {
    const req: OpenAIChatRequest = {
      model: 'gpt-x',
      messages: [
        { role: 'system', content: '系统' },
        { role: 'user', content: '查天气' },
        { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'wx', arguments: '{"q":"bj"}' } }] },
        { role: 'tool', tool_call_id: 'c1', content: '晴' },
        { role: 'user', content: '谢谢' },
      ],
    }
    const back = irToOpenAIChatRequest(openaiToIR(req))
    expect(back.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool', 'user'])
    expect(back.messages[2].tool_calls?.[0].function).toEqual({ name: 'wx', arguments: '{"q":"bj"}' })
    expect(back.messages[3]).toEqual({ role: 'tool', tool_call_id: 'c1', content: '晴' })
  })
})

// ─── OpenAI 响应 → IR ─────────────────────────────────────────────
describe('openAIChatResponseToIR', () => {
  const base = (over: Partial<OpenAIChatCompletion> = {}): OpenAIChatCompletion => ({
    id: 'x',
    object: 'chat.completion',
    created: 0,
    model: 'm',
    choices: [{ index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    ...over,
  })

  it('文本响应 → text 块 + end_turn + usage', () => {
    const ir = openAIChatResponseToIR(base())
    expect(ir.content).toEqual([{ type: 'text', text: 'hi' }])
    expect(ir.stopReason).toBe('end_turn')
    expect(ir.usage).toEqual({ inputTokens: 10, outputTokens: 5 })
  })

  it('tool_calls 响应 → tool_use 块 + tool_use 停因', () => {
    const ir = openAIChatResponseToIR(
      base({
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'f', arguments: '{"a":1}' } }] },
            finish_reason: 'tool_calls',
          },
        ],
      }),
    )
    expect(ir.content).toEqual([{ type: 'tool_use', id: 'c1', name: 'f', input: { a: 1 } }])
    expect(ir.stopReason).toBe('tool_use')
  })

  it('finish_reason length → max_tokens;cached_tokens → cacheReadTokens', () => {
    const ir = openAIChatResponseToIR(
      base({
        choices: [{ index: 0, message: { role: 'assistant', content: 'x' }, finish_reason: 'length' }],
        usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10, prompt_tokens_details: { cached_tokens: 3 } },
      }),
    )
    expect(ir.stopReason).toBe('max_tokens')
    // IR inputTokens 为非缓存新增：prompt_tokens(8) - cached(3) = 5；cache 命中单列。
    expect(ir.usage.inputTokens).toBe(5)
    expect(ir.usage.cacheReadTokens).toBe(3)
  })

  it('reasoning_content(DeepSeek 兼容)→ thinking 块', () => {
    const resp = base()
    ;(resp.choices[0].message as Record<string, unknown>).reasoning_content = '让我想想'
    const ir = openAIChatResponseToIR(resp)
    expect(ir.content[0]).toEqual({ type: 'thinking', text: '让我想想' })
    expect(ir.content[1]).toEqual({ type: 'text', text: 'hi' })
  })

  it('非法 tool arguments → 空对象(不抛)', () => {
    const ir = openAIChatResponseToIR(
      base({
        choices: [
          { index: 0, message: { role: 'assistant', content: null, tool_calls: [{ id: 'c', type: 'function', function: { name: 'f', arguments: '{bad' } }] }, finish_reason: 'tool_calls' },
        ],
      }),
    )
    expect((ir.content[0] as { input: unknown }).input).toEqual({})
  })
})

// ─── OpenAI SSE → IR 事件 ─────────────────────────────────────────
describe('createOpenAiSseToEventsParser', () => {
  const sse = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`
  const chunk = (delta: unknown, finish: string | null = null, usage?: unknown) => ({
    id: 'c',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'm',
    choices: [{ index: 0, delta, finish_reason: finish }],
    ...(usage ? { usage } : {}),
  })

  it('文本增量 → text_delta + message_stop;[DONE] 收尾', () => {
    const text =
      sse(chunk({ role: 'assistant' })) +
      sse(chunk({ content: '你' })) +
      sse(chunk({ content: '好' })) +
      sse(chunk({}, 'stop')) +
      'data: [DONE]\n\n'
    const events = parseOpenAiSse(text)
    expect(events).toEqual([
      { type: 'text_delta', text: '你' },
      { type: 'text_delta', text: '好' },
      { type: 'message_stop', stopReason: 'end_turn' },
    ])
  })

  it('tool_calls 流式:首帧(id+name)→ tool_use_start;arguments 片段 → tool_use_delta', () => {
    const text =
      sse(chunk({ tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'wx', arguments: '' } }] })) +
      sse(chunk({ tool_calls: [{ index: 0, function: { arguments: '{"q":' } }] })) +
      sse(chunk({ tool_calls: [{ index: 0, function: { arguments: '"bj"}' } }] })) +
      sse(chunk({}, 'tool_calls')) +
      'data: [DONE]\n\n'
    const events = parseOpenAiSse(text)
    expect(events).toEqual([
      { type: 'tool_use_start', index: 0, id: 'c1', name: 'wx' },
      { type: 'tool_use_delta', index: 0, partialJson: '{"q":' },
      { type: 'tool_use_delta', index: 0, partialJson: '"bj"}' },
      { type: 'message_stop', stopReason: 'tool_use' },
    ])
  })

  it('usage 帧(include_usage)→ usage 事件', () => {
    const text =
      sse(chunk({ content: 'x' })) +
      sse({ ...chunk({}, 'stop'), choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) +
      sse({ id: 'c', object: 'chat.completion.chunk', created: 0, model: 'm', choices: [], usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 } }) +
      'data: [DONE]\n\n'
    const events = parseOpenAiSse(text)
    expect(events).toContainEqual({ type: 'usage', usage: { inputTokens: 7, outputTokens: 3 } })
  })

  it('reasoning_content 增量 → thinking_delta', () => {
    const events = parseOpenAiSse(sse(chunk({ reasoning_content: '嗯' })) + 'data: [DONE]\n\n')
    expect(events).toEqual([{ type: 'thinking_delta', text: '嗯' }])
  })

  it('半帧跨 push:一条 data 行被切两半,仍正确解析', () => {
    const parser = createOpenAiSseToEventsParser()
    const full = sse(chunk({ content: 'hello' }))
    const cut = Math.floor(full.length / 2)
    const a = parser.push(full.slice(0, cut))
    const b = parser.push(full.slice(cut))
    expect([...a, ...b]).toEqual([{ type: 'text_delta', text: 'hello' }])
  })

  it('畸形帧跳过,不影响后续', () => {
    const events = parseOpenAiSse('data: {not json\n\n' + sse(chunk({ content: 'ok' })) + 'data: [DONE]\n\n')
    expect(events).toEqual([{ type: 'text_delta', text: 'ok' }])
  })

  it('[DONE] 之后的内容被忽略', () => {
    const events = parseOpenAiSse('data: [DONE]\n\n' + sse(chunk({ content: '不该出现' })))
    expect(events).toEqual([])
  })

  it('往返:serializeOpenAIStream(IR事件) → parseOpenAiSse → 原事件(语义等价)', () => {
    const evs: CanonicalStreamEvent[] = [
      { type: 'text_delta', text: 'a' },
      { type: 'tool_use_start', index: 0, id: 'c1', name: 'f' },
      { type: 'tool_use_delta', index: 0, partialJson: '{"x":1}' },
      { type: 'message_stop', stopReason: 'tool_use' },
    ]
    const frames = serializeOpenAIStream(evs, 'm')
    const back = parseOpenAiSse(frames.join(''))
    expect(back).toEqual(evs)
  })
})
