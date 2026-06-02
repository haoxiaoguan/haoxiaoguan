import { describe, it, expect } from 'vitest'
import type {
  PlatformUpstreamAdapter,
  UpstreamCtx,
  ModelInfo,
} from '../../../src/main/contexts/apiProxy/domain/platform-adapter'
import type {
  CanonicalRequest,
  CanonicalResponse,
  CanonicalStreamEvent,
} from '../../../src/main/contexts/apiProxy/domain/canonical'

// 内联 fake：仅为固化接口契约（与 Echo 解耦，避免本测试依赖 Task 3）。
class FakeAdapter implements PlatformUpstreamAdapter {
  readonly platform = 'fake'
  supportsModel(model: string): boolean {
    return model === 'fake-1'
  }
  listModels(): ModelInfo[] {
    return [{ id: 'fake-1', displayName: 'Fake One' }]
  }
  async chat(ir: CanonicalRequest, _ctx: UpstreamCtx): Promise<CanonicalResponse> {
    return { model: ir.model, content: [{ type: 'text', text: 'ok' }], stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 } }
  }
  async *chatStream(ir: CanonicalRequest, _ctx: UpstreamCtx): AsyncIterable<CanonicalStreamEvent> {
    yield { type: 'text_delta', text: 'ok' }
    yield { type: 'message_stop', stopReason: 'end_turn' }
  }
}

describe('PlatformUpstreamAdapter contract', () => {
  it('exposes platform/supportsModel/listModels', () => {
    const a = new FakeAdapter()
    expect(a.platform).toBe('fake')
    expect(a.supportsModel('fake-1')).toBe(true)
    expect(a.supportsModel('nope')).toBe(false)
    expect(a.listModels()).toEqual([{ id: 'fake-1', displayName: 'Fake One' }])
  })

  it('chat returns a CanonicalResponse', async () => {
    const a = new FakeAdapter()
    const resp = await a.chat({ model: 'fake-1', messages: [], stream: false }, {})
    expect(resp.stopReason).toBe('end_turn')
    expect(resp.content[0]).toEqual({ type: 'text', text: 'ok' })
  })

  it('chatStream yields events ending in message_stop', async () => {
    const a = new FakeAdapter()
    const events: CanonicalStreamEvent[] = []
    for await (const ev of a.chatStream({ model: 'fake-1', messages: [], stream: true }, {})) events.push(ev)
    expect(events.at(-1)).toEqual({ type: 'message_stop', stopReason: 'end_turn' })
  })
})
