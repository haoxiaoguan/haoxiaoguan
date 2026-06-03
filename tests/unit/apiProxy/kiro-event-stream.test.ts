import { describe, it, expect } from 'vitest'
import {
  parseKiroEventStream,
  encodeKiroEventStream,
  extractEventType,
  createKiroEventStreamParser,
} from '../../../src/main/contexts/apiProxy/infrastructure/adapters/kiro/kiro-event-stream'
import type { CanonicalStreamEvent } from '../../../src/main/contexts/apiProxy/domain/canonical'

// 用编码辅助手工拼合成帧，避免依赖真实网络字节。
function frames(list: { eventType: string; payload: unknown }[]): Uint8Array {
  return encodeKiroEventStream(list)
}

describe('extractEventType (round-trips through encodeKiroEventStream single frame)', () => {
  it('reads :event-type back from an encoded frame header', () => {
    const bytes = encodeKiroEventStream([{ eventType: 'assistantResponseEvent', payload: { content: 'hi' } }])
    // 第一帧 header 区间：12 .. 12+headersLen；用 DataView 读 headersLen 后切出 headers。
    const dv = new DataView(bytes.buffer, bytes.byteOffset)
    const headersLen = dv.getUint32(4, false)
    const headers = bytes.slice(12, 12 + headersLen)
    expect(extractEventType(headers)).toBe('assistantResponseEvent')
  })
})

describe('parseKiroEventStream — text', () => {
  it('emits text_delta for assistantResponseEvent + final usage + message_stop', () => {
    const events = parseKiroEventStream(
      frames([
        { eventType: 'assistantResponseEvent', payload: { content: 'Hello ' } },
        { eventType: 'assistantResponseEvent', payload: { content: 'world' } },
        { eventType: 'messageMetadataEvent', payload: { tokenUsage: { uncachedInputTokens: 10, outputTokens: 5 } } },
      ]),
    )
    expect(events).toEqual<CanonicalStreamEvent[]>([
      { type: 'text_delta', text: 'Hello ' },
      { type: 'text_delta', text: 'world' },
      { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
      { type: 'message_stop', stopReason: 'end_turn' },
    ])
  })

  it('treats codeEvent like text', () => {
    const events = parseKiroEventStream(frames([{ eventType: 'codeEvent', payload: { content: 'const x = 1' } }]))
    expect(events[0]).toEqual({ type: 'text_delta', text: 'const x = 1' })
    expect(events.at(-1)).toEqual({ type: 'message_stop', stopReason: 'end_turn' })
  })

  it('sums cache tokens into inputTokens', () => {
    const events = parseKiroEventStream(
      frames([
        { eventType: 'messageMetadataEvent', payload: { tokenUsage: { uncachedInputTokens: 3, cacheReadInputTokens: 7, cacheWriteInputTokens: 2, outputTokens: 4 } } },
      ]),
    )
    const usage = events.find((e) => e.type === 'usage')
    expect(usage).toEqual({ type: 'usage', usage: { inputTokens: 12, outputTokens: 4, cacheReadTokens: 7, cacheWriteTokens: 2 } })
  })

  it('contextUsageEvent → 末 usage 事件带 contextUsagePercentage', () => {
    const bytes = encodeKiroEventStream([
      { eventType: 'assistantResponseEvent', payload: { content: 'Hi' } },
      { eventType: 'contextUsageEvent', payload: { contextUsagePercentage: 2.05 } },
      { eventType: 'meteringEvent', payload: { usage: 0.01, unit: 'credit' } },
    ])
    const events = parseKiroEventStream(bytes)
    const usageEv = events.find((e) => e.type === 'usage')
    expect(usageEv).toBeDefined()
    expect(usageEv && 'contextUsagePercentage' in usageEv ? usageEv.contextUsagePercentage : undefined).toBeCloseTo(2.05)
  })
})

describe('parseKiroEventStream — thinking', () => {
  it('emits thinking_delta for reasoningContentEvent with text', () => {
    const events = parseKiroEventStream(
      frames([
        { eventType: 'reasoningContentEvent', payload: { text: 'let me think' } },
        { eventType: 'assistantResponseEvent', payload: { content: 'answer' } },
      ]),
    )
    expect(events[0]).toEqual({ type: 'thinking_delta', text: 'let me think' })
    expect(events[1]).toEqual({ type: 'text_delta', text: 'answer' })
  })

  it('ignores reasoningContentEvent without text (signature-only)', () => {
    const events = parseKiroEventStream(frames([{ eventType: 'reasoningContentEvent', payload: { signature: 'sig' } }]))
    expect(events.some((e) => e.type === 'thinking_delta')).toBe(false)
  })
})

describe('parseKiroEventStream — tool use', () => {
  it('emits tool_use_start then tool_use_delta(s) accumulating partial json, ends with tool_use stopReason', () => {
    const events = parseKiroEventStream(
      frames([
        { eventType: 'toolUseEvent', payload: { toolUseId: 'tu_1', name: 'get_weather' } },
        { eventType: 'toolUseEvent', payload: { toolUseId: 'tu_1', input: '{"city":' } },
        { eventType: 'toolUseEvent', payload: { toolUseId: 'tu_1', input: '"SF"}' } },
        { eventType: 'toolUseEvent', payload: { toolUseId: 'tu_1', stop: true } },
      ]),
    )
    expect(events).toEqual<CanonicalStreamEvent[]>([
      { type: 'tool_use_start', index: 0, id: 'tu_1', name: 'get_weather' },
      { type: 'tool_use_delta', index: 0, partialJson: '{"city":' },
      { type: 'tool_use_delta', index: 0, partialJson: '"SF"}' },
      { type: 'usage', usage: { inputTokens: 0, outputTokens: 0 } },
      { type: 'message_stop', stopReason: 'tool_use' },
    ])
  })

  it('serializes an object input into a single delta', () => {
    const events = parseKiroEventStream(
      frames([
        { eventType: 'toolUseEvent', payload: { toolUseId: 'tu_2', name: 't' } },
        { eventType: 'toolUseEvent', payload: { toolUseId: 'tu_2', input: { a: 1 }, stop: true } },
      ]),
    )
    expect(events).toContainEqual({ type: 'tool_use_delta', index: 0, partialJson: '{"a":1}' })
    expect(events.at(-1)).toEqual({ type: 'message_stop', stopReason: 'tool_use' })
  })

  it('auto-closes the previous tool when a new toolUseId starts; assigns incrementing index', () => {
    const events = parseKiroEventStream(
      frames([
        { eventType: 'toolUseEvent', payload: { toolUseId: 'tu_a', name: 'a' } },
        { eventType: 'toolUseEvent', payload: { toolUseId: 'tu_a', input: '{}' } },
        { eventType: 'toolUseEvent', payload: { toolUseId: 'tu_b', name: 'b' } },
        { eventType: 'toolUseEvent', payload: { toolUseId: 'tu_b', input: '{}', stop: true } },
      ]),
    )
    const starts = events.filter((e) => e.type === 'tool_use_start')
    expect(starts).toEqual([
      { type: 'tool_use_start', index: 0, id: 'tu_a', name: 'a' },
      { type: 'tool_use_start', index: 1, id: 'tu_b', name: 'b' },
    ])
  })
})

describe('parseKiroEventStream — robustness', () => {
  it('skips frames whose payload is not valid JSON', () => {
    // 构造一帧合法 + 一帧非法 JSON payload。
    const good = encodeKiroEventStream([{ eventType: 'assistantResponseEvent', payload: { content: 'ok' } }])
    const bad = encodeRawFrame('assistantResponseEvent', new TextEncoder().encode('{not json'))
    const combined = new Uint8Array(good.length + bad.length)
    combined.set(good)
    combined.set(bad, good.length)
    const events = parseKiroEventStream(combined)
    expect(events[0]).toEqual({ type: 'text_delta', text: 'ok' })
    expect(events.at(-1)).toEqual({ type: 'message_stop', stopReason: 'end_turn' })
  })

  it('returns just usage + message_stop for an empty byte buffer', () => {
    const events = parseKiroEventStream(new Uint8Array(0))
    expect(events).toEqual([
      { type: 'usage', usage: { inputTokens: 0, outputTokens: 0 } },
      { type: 'message_stop', stopReason: 'end_turn' },
    ])
  })
})

describe('createKiroEventStreamParser', () => {
  it('分片喂入与整段解析结果一致（切在帧中间）', () => {
    const bytes = encodeKiroEventStream([
      { eventType: 'assistantResponseEvent', payload: { content: 'Hel' } },
      { eventType: 'assistantResponseEvent', payload: { content: 'lo' } },
      { eventType: 'messageMetadataEvent', payload: { tokenUsage: { uncachedInputTokens: 10, outputTokens: 5 } } },
    ])
    const whole = parseKiroEventStream(bytes)
    // 用累进 offset 切成多片（含帧中间位置）逐片 push，最后 flush
    const p = createKiroEventStreamParser()
    const got: ReturnType<typeof parseKiroEventStream> = []
    const cuts = [1, 7, 13, 20, bytes.length]
    let prev = 0
    for (const cut of cuts) {
      const end = Math.min(cut, bytes.length)
      if (end > prev) {
        got.push(...p.push(bytes.slice(prev, end)))
      }
      prev = end
    }
    got.push(...p.flush())
    expect(got).toEqual(whole)
  })

  it('push 不发 usage/message_stop，flush 才补', () => {
    const bytes = encodeKiroEventStream([
      { eventType: 'assistantResponseEvent', payload: { content: 'hi' } },
      { eventType: 'messageMetadataEvent', payload: { tokenUsage: { uncachedInputTokens: 3, outputTokens: 2 } } },
    ])
    const p = createKiroEventStreamParser()
    const fromPush = p.push(bytes)
    // push 阶段只含 text_delta，不含 usage/message_stop
    expect(fromPush).toEqual([{ type: 'text_delta', text: 'hi' }])
    const fromFlush = p.flush()
    // flush 补 usage + message_stop
    expect(fromFlush).toEqual([
      { type: 'usage', usage: { inputTokens: 3, outputTokens: 2 } },
      { type: 'message_stop', stopReason: 'end_turn' },
    ])
  })

  it('未完成半帧暂存，补齐后解出', () => {
    const bytes = encodeKiroEventStream([
      { eventType: 'assistantResponseEvent', payload: { content: 'abc' } },
    ])
    // 只喂前半截 → 不完整，什么都不返回
    const mid = Math.floor(bytes.length / 2)
    const p = createKiroEventStreamParser()
    const fromHalf = p.push(bytes.slice(0, mid))
    expect(fromHalf).toEqual([])
    // 喂剩余 → 完整帧解出
    const fromRest = p.push(bytes.slice(mid))
    expect(fromRest).toEqual([{ type: 'text_delta', text: 'abc' }])
    const fromFlush = p.flush()
    expect(fromFlush[0]).toMatchObject({ type: 'usage' })
    expect(fromFlush[1]).toEqual({ type: 'message_stop', stopReason: 'end_turn' })
  })
})

// 测试本地辅助：按帧格式手工拼一帧（payload 任意字节，用于非法 JSON 场景）。
// 与生产 encodeKiroEventStream 同布局；此处独立实现以便喂任意 payload 字节。
function encodeRawFrame(eventType: string, payload: Uint8Array): Uint8Array {
  const enc = new TextEncoder()
  const nameBytes = enc.encode(':event-type')
  const typeBytes = enc.encode(eventType)
  // header: 1B nameLen | name | 1B valueType(7) | 2B valueLen | value
  const headerLen = 1 + nameBytes.length + 1 + 2 + typeBytes.length
  const headers = new Uint8Array(headerLen)
  let o = 0
  headers[o++] = nameBytes.length
  headers.set(nameBytes, o); o += nameBytes.length
  headers[o++] = 7
  headers[o++] = (typeBytes.length >> 8) & 0xff
  headers[o++] = typeBytes.length & 0xff
  headers.set(typeBytes, o); o += typeBytes.length
  const total = 12 + headerLen + payload.length + 4
  const buf = new Uint8Array(total)
  const dv = new DataView(buf.buffer)
  dv.setUint32(0, total, false)
  dv.setUint32(4, headerLen, false)
  dv.setUint32(8, 0, false) // prelude CRC 占位
  buf.set(headers, 12)
  buf.set(payload, 12 + headerLen)
  dv.setUint32(total - 4, 0, false) // msg CRC 占位
  return buf
}
