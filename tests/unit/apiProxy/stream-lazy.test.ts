import { describe, it, expect } from 'vitest'
import type { CanonicalStreamEvent } from '../../../src/main/contexts/apiProxy/domain/canonical'
import {
  serializeOpenAIStream,
  serializeOpenAIStreamLazy,
} from '../../../src/main/contexts/apiProxy/infrastructure/inbound/openai'
import {
  serializeAnthropicStream,
  serializeAnthropicStreamLazy,
} from '../../../src/main/contexts/apiProxy/infrastructure/inbound/anthropic'

// 把 string[] 转成 AsyncIterable<string> 的辅助（用于同步版比对）
async function* arrayToAsyncIterable<T>(arr: T[]): AsyncIterable<T> {
  yield* arr
}

// 收集 AsyncIterable 所有 yield 值
async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = []
  for await (const v of it) result.push(v)
  return result
}

// 构造「可观测拉取进度」的 async generator，每 yield 一个 event 记 pulled++
function makeObservableEvents(events: CanonicalStreamEvent[]): {
  gen: () => AsyncIterable<CanonicalStreamEvent>
  getPulled: () => number
} {
  let pulled = 0
  const gen = async function* (): AsyncIterable<CanonicalStreamEvent> {
    for (const ev of events) {
      pulled++
      yield ev
    }
  }
  return { gen, getPulled: () => pulled }
}

// ─────────────── OpenAI 惰性版 ───────────────

describe('serializeOpenAIStreamLazy', () => {
  const sampleEvents: CanonicalStreamEvent[] = [
    { type: 'text_delta', text: 'Hel' },
    { type: 'text_delta', text: 'lo' },
    { type: 'usage', usage: { inputTokens: 7, outputTokens: 2 } },
    { type: 'message_stop', stopReason: 'end_turn' },
  ]

  it('真惰性：首帧 yield 时不应把全部 event 拉完', async () => {
    const { gen, getPulled } = makeObservableEvents(sampleEvents)
    const lazy = serializeOpenAIStreamLazy(gen(), 'gpt-4o', { id: 'chatcmpl-test', created: 0 })
    const it = lazy[Symbol.asyncIterator]()
    // 首帧 role=assistant 是在事件循环前 yield 的，此时 events 尚未被消费
    const first = await it.next()
    expect(first.done).toBe(false)
    // 首帧 yield 后，source generator 里的事件不应全部被拉走
    // （首帧在 for await 之前 yield，所以 pulled 此时应为 0）
    expect(getPulled()).toBe(0)
    // 继续消费完毕
    while (!(await it.next()).done) { /* drain */ }
  })

  it('对同一 events，惰性版与同步版帧序列完全一致', async () => {
    const syncFrames = serializeOpenAIStream(sampleEvents, 'gpt-4o', { id: 'chatcmpl-x', created: 100 })
    const lazyFrames = await collect(
      serializeOpenAIStreamLazy(arrayToAsyncIterable(sampleEvents), 'gpt-4o', { id: 'chatcmpl-x', created: 100 }),
    )
    expect(lazyFrames).toEqual(syncFrames)
  })

  it('tool_use_start + tool_use_delta → 惰性版与同步版一致', async () => {
    const events: CanonicalStreamEvent[] = [
      { type: 'tool_use_start', index: 0, id: 'call_1', name: 'get_weather' },
      { type: 'tool_use_delta', index: 0, partialJson: '{"city":"SF"}' },
      { type: 'message_stop', stopReason: 'tool_use' },
    ]
    const syncFrames = serializeOpenAIStream(events, 'm', { id: 'x', created: 0 })
    const lazyFrames = await collect(serializeOpenAIStreamLazy(arrayToAsyncIterable(events), 'm', { id: 'x', created: 0 }))
    expect(lazyFrames).toEqual(syncFrames)
  })

  it('末帧是 data: [DONE]\\n\\n', async () => {
    const frames = await collect(
      serializeOpenAIStreamLazy(
        arrayToAsyncIterable([{ type: 'message_stop', stopReason: 'end_turn' }]),
        'm',
        { id: 'x', created: 0 },
      ),
    )
    expect(frames[frames.length - 1]).toBe('data: [DONE]\n\n')
  })
})

// ─────────────── Anthropic 惰性版 ───────────────

describe('serializeAnthropicStreamLazy', () => {
  // 解析 SSE 帧为 [{ event, data }]
  const parseEvents = (frames: string[]): { event: string; data: unknown }[] =>
    frames.map((f) => {
      const lines = f.trimEnd().split('\n')
      const event = lines[0].slice('event: '.length)
      const data = JSON.parse(lines[1].slice('data: '.length))
      return { event, data }
    })

  const sampleStreamEvents: CanonicalStreamEvent[] = [
    { type: 'text_delta', text: 'He' },
    { type: 'text_delta', text: 'llo' },
    { type: 'usage', usage: { inputTokens: 4, outputTokens: 2 } },
    { type: 'message_stop', stopReason: 'end_turn' },
  ]

  it('真惰性：首帧 yield 时 source generator 未被拉取', async () => {
    const { gen, getPulled } = makeObservableEvents(sampleStreamEvents)
    const lazy = serializeAnthropicStreamLazy(gen(), { model: 'm', inputTokens: 4 }, { id: 'msg_lazy' })
    const it = lazy[Symbol.asyncIterator]()
    const first = await it.next()
    expect(first.done).toBe(false)
    // message_start 在 for await 之前 yield，source 不应已被拉取
    expect(getPulled()).toBe(0)
    // drain
    while (!(await it.next()).done) { /* drain */ }
  })

  it('message_start.usage 的 input_tokens === 传入 start.inputTokens', async () => {
    const frames = await collect(
      serializeAnthropicStreamLazy(
        arrayToAsyncIterable(sampleStreamEvents),
        { model: 'm', inputTokens: 42 },
        { id: 'msg_t' },
      ),
    )
    const events = parseEvents(frames)
    const startData = events[0].data as { message: { usage: Record<string, number> } }
    expect(startData.message.usage.input_tokens).toBe(42)
    expect(startData.message.usage.output_tokens).toBe(0)
  })

  it('message_start.usage 不含 cache_read_input_tokens / cache_creation_input_tokens（惰性降级）', async () => {
    const frames = await collect(
      serializeAnthropicStreamLazy(
        arrayToAsyncIterable(sampleStreamEvents),
        { model: 'm', inputTokens: 10 },
        { id: 'msg_t' },
      ),
    )
    const startFrame = frames.find((f) => f.includes('message_start'))!
    expect(startFrame).not.toContain('cache_read_input_tokens')
    expect(startFrame).not.toContain('cache_creation_input_tokens')
  })

  it('帧序：message_start → content_block_start → content_block_delta → content_block_stop → message_delta → message_stop', async () => {
    const frames = await collect(
      serializeAnthropicStreamLazy(
        arrayToAsyncIterable(sampleStreamEvents),
        { model: 'm', inputTokens: 4 },
        { id: 'msg_seq' },
      ),
    )
    const events = parseEvents(frames)
    const seq = events.map((e) => e.event)
    expect(seq[0]).toBe('message_start')
    expect(seq).toContain('content_block_start')
    expect(seq).toContain('content_block_delta')
    expect(seq).toContain('content_block_stop')
    expect(seq).toContain('message_delta')
    expect(seq[seq.length - 1]).toBe('message_stop')
  })

  it('content_block_delta 帧 text 内容与 events 一致', async () => {
    const frames = await collect(
      serializeAnthropicStreamLazy(
        arrayToAsyncIterable(sampleStreamEvents),
        { model: 'm', inputTokens: 4 },
        { id: 'msg_t' },
      ),
    )
    const events = parseEvents(frames)
    const deltas = events
      .filter((e) => e.event === 'content_block_delta')
      .map((e) => (e.data as { delta: { text?: string } }).delta.text)
    expect(deltas).toEqual(['He', 'llo'])
  })

  it('message_delta 携带正确 stop_reason + output_tokens（来自 usage event）', async () => {
    const frames = await collect(
      serializeAnthropicStreamLazy(
        arrayToAsyncIterable(sampleStreamEvents),
        { model: 'm', inputTokens: 4 },
        { id: 'msg_t' },
      ),
    )
    const events = parseEvents(frames)
    const msgDelta = events.find((e) => e.event === 'message_delta')!.data as {
      delta: { stop_reason: string }
      usage: { output_tokens: number }
    }
    expect(msgDelta.delta.stop_reason).toBe('end_turn')
    expect(msgDelta.usage.output_tokens).toBe(2)
  })

  it('tool_use 流：惰性版 content_block_start(tool_use) + input_json_delta 帧序与同步版一致（除 message_start usage 字段）', async () => {
    const toolEvents: CanonicalStreamEvent[] = [
      { type: 'tool_use_start', index: 0, id: 'tu_1', name: 'get_weather' },
      { type: 'tool_use_delta', index: 0, partialJson: '{"city":"SF"}' },
      { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } },
      { type: 'message_stop', stopReason: 'tool_use' },
    ]
    const lazyFrames = await collect(
      serializeAnthropicStreamLazy(
        arrayToAsyncIterable(toolEvents),
        { model: 'm', inputTokens: 1 },
        { id: 'x' },
      ),
    )
    const lazyEvents = parseEvents(lazyFrames)

    // content_block_start 正确
    const cbStart = lazyEvents.find((e) => e.event === 'content_block_start')!.data as {
      content_block: { type: string; id: string; name: string }
    }
    expect(cbStart.content_block).toEqual({ type: 'tool_use', id: 'tu_1', name: 'get_weather', input: {} })

    // input_json_delta 正确
    const jsonDelta = lazyEvents
      .filter((e) => e.event === 'content_block_delta')
      .map((e) => (e.data as { delta: { type: string; partial_json?: string } }).delta)[0]
    expect(jsonDelta).toEqual({ type: 'input_json_delta', partial_json: '{"city":"SF"}' })

    // message_delta stop_reason=tool_use
    const msgDelta = lazyEvents.find((e) => e.event === 'message_delta')!.data as {
      delta: { stop_reason: string }
    }
    expect(msgDelta.delta.stop_reason).toBe('tool_use')
  })

  it('非 message_start 的其余帧，与同步版 serializeAnthropicStream 帧序/内容一致', async () => {
    // 同步版需要 CanonicalResponse；用和 sampleStreamEvents 对应的 resp
    const resp = {
      model: 'm',
      content: [] as [],
      stopReason: 'end_turn' as const,
      usage: { inputTokens: 4, outputTokens: 0 },
    }
    const syncFrames = serializeAnthropicStream(resp, sampleStreamEvents, { id: 'msg_cmp' })
    const lazyFrames = await collect(
      serializeAnthropicStreamLazy(
        arrayToAsyncIterable(sampleStreamEvents),
        { model: 'm', inputTokens: 4 },
        { id: 'msg_cmp' },
      ),
    )

    // 跳过两版各自的 message_start 帧，比对其余帧
    const syncRest = syncFrames.slice(1)
    const lazyRest = lazyFrames.slice(1)
    expect(lazyRest).toEqual(syncRest)
  })
})
