import { describe, it, expect } from 'vitest'
import { serializeResponsesStream } from '../../../src/main/contexts/apiProxy/infrastructure/inbound/responses/responses-stream'
import type { CanonicalStreamEvent } from '../../../src/main/contexts/apiProxy/domain/canonical'

const OPTS = { id: 'resp_1', itemId: (i: number) => `item_${i}`, createdAt: 0, model: 'm' }

function deferred<T>(): { p: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void
  const p = new Promise<T>((r) => { resolve = r })
  return { p, resolve }
}

async function* fromArray(evs: CanonicalStreamEvent[]): AsyncIterable<CanonicalStreamEvent> {
  for (const e of evs) yield e
}

async function collect(gen: AsyncGenerator<string>): Promise<string[]> {
  const out: string[] = []
  for (;;) {
    const r = await gen.next()
    if (r.done) break
    out.push(r.value)
  }
  return out
}

describe('serializeResponsesStream（真流式异步生成器）', () => {
  it('created/in_progress 立即发出——先于上游首事件（修复长 TTFT 断连的关键）', async () => {
    const gate = deferred<void>()
    async function* slow(): AsyncIterable<CanonicalStreamEvent> {
      await gate.p
      yield { type: 'text_delta', text: 'Hi' }
      yield { type: 'message_stop', stopReason: 'end_turn' }
    }
    const gen = serializeResponsesStream(slow(), OPTS)
    const f1 = await gen.next()
    const f2 = await gen.next()
    // 上游 gate 尚未放行，但 created/in_progress 已经发出。
    expect(f1.value).toContain('event: response.created')
    expect(f2.value).toContain('event: response.in_progress')
    gate.resolve()
    const rest = (await collect(gen)).join('')
    expect(rest).toContain('event: response.output_text.delta')
    expect(rest).toContain('event: response.completed')
  })

  it('文本流：output_item.added→content_part.added→delta→completed→[DONE]；onComplete 收到全部事件', async () => {
    const events: CanonicalStreamEvent[] = [
      { type: 'text_delta', text: 'Hi' },
      { type: 'usage', usage: { inputTokens: 10, outputTokens: 1 } },
      { type: 'message_stop', stopReason: 'end_turn' },
    ]
    let got: CanonicalStreamEvent[] | null = null
    const gen = serializeResponsesStream(fromArray(events), { ...OPTS, onComplete: (e) => { got = e } })
    const frames = await collect(gen)
    const joined = frames.join('')
    expect(joined).toContain('event: response.created')
    expect(joined).toContain('event: response.output_item.added')
    expect(joined).toContain('event: response.content_part.added')
    expect(joined).toContain('event: response.output_text.delta')
    expect(joined).toContain('event: response.completed')
    expect(frames[frames.length - 1]).toBe('data: [DONE]\n\n')
    expect(got).toHaveLength(3)
  })

  it('工具流：function_call item + function_call_arguments.delta + 收尾', async () => {
    const events: CanonicalStreamEvent[] = [
      { type: 'tool_use_start', index: 0, id: 'c1', name: 'f' },
      { type: 'tool_use_delta', index: 0, partialJson: '{"a":1}' },
      { type: 'message_stop', stopReason: 'tool_use' },
    ]
    const joined = (await collect(serializeResponsesStream(fromArray(events), OPTS))).join('')
    expect(joined).toContain('"type":"function_call"')
    expect(joined).toContain('event: response.function_call_arguments.delta')
    expect(joined).toContain('event: response.completed')
  })

  it('上游静默期发 SSE 心跳保活', async () => {
    const gate = deferred<void>()
    async function* slow(): AsyncIterable<CanonicalStreamEvent> {
      await gate.p
      yield { type: 'text_delta', text: 'Hi' }
      yield { type: 'message_stop', stopReason: 'end_turn' }
    }
    const gen = serializeResponsesStream(slow(), { ...OPTS, heartbeatMs: 10 })
    await gen.next() // created
    await gen.next() // in_progress
    // 进入循环，上游静默 → 10ms 后应先得到心跳帧（gate 尚未放行）。
    const hb = await gen.next()
    expect(hb.value).toBe(': keep-alive\n\n')
    gate.resolve()
    const rest = (await collect(gen)).join('')
    expect(rest).toContain('event: response.output_text.delta')
    expect(rest).toContain('event: response.completed')
  })

  it('custom 工具流式 → custom_tool_call 帧序（output_item.added custom_tool_call + input.delta/.done + done）', async () => {
    const events: CanonicalStreamEvent[] = [
      { type: 'tool_use_start', index: 0, id: 'c1', name: 'apply_patch' },
      { type: 'tool_use_delta', index: 0, partialJson: '{"input":"' },
      { type: 'tool_use_delta', index: 0, partialJson: '*** Begin Patch"}' },
      { type: 'message_stop', stopReason: 'tool_use' },
    ]
    const gen = serializeResponsesStream(fromArray(events), { ...OPTS, customToolNames: new Set(['apply_patch']) })
    const joined = (await collect(gen)).join('')
    expect(joined).toContain('"type":"custom_tool_call"')
    expect(joined).toContain('event: response.custom_tool_call_input.delta')
    expect(joined).toContain('event: response.custom_tool_call_input.done')
    expect(joined).toContain('*** Begin Patch') // 还原出的 freeform input
    // 不应把 custom 工具当 function：无 function_call_arguments.delta
    expect(joined).not.toContain('event: response.function_call_arguments.delta')
    expect(joined).toContain('event: response.completed')
  })

  it('非 custom 工具仍走 function_call（不在 customToolNames 内）', async () => {
    const events: CanonicalStreamEvent[] = [
      { type: 'tool_use_start', index: 0, id: 'c2', name: 'shell' },
      { type: 'tool_use_delta', index: 0, partialJson: '{"command":["ls"]}' },
      { type: 'message_stop', stopReason: 'tool_use' },
    ]
    const gen = serializeResponsesStream(fromArray(events), { ...OPTS, customToolNames: new Set(['apply_patch']) })
    const joined = (await collect(gen)).join('')
    expect(joined).toContain('"type":"function_call"')
    expect(joined).toContain('event: response.function_call_arguments.delta')
    expect(joined).not.toContain('custom_tool_call')
  })

  it('上游中途出错 → response.failed + [DONE]，且不回调 onComplete', async () => {
    async function* boom(): AsyncIterable<CanonicalStreamEvent> {
      yield { type: 'text_delta', text: 'Hi' }
      throw new Error('upstream 502 bad gateway')
    }
    let completed = false
    const frames = await collect(serializeResponsesStream(boom(), { ...OPTS, onComplete: () => { completed = true } }))
    const joined = frames.join('')
    expect(joined).toContain('event: response.created')
    expect(joined).toContain('event: response.output_text.delta') // 出错前的部分仍已下发
    expect(joined).toContain('event: response.failed')
    expect(joined).toContain('upstream 502 bad gateway')
    expect(frames[frames.length - 1]).toBe('data: [DONE]\n\n')
    expect(completed).toBe(false)
  })
})
