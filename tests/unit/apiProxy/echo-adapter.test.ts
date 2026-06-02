import { describe, it, expect } from 'vitest'
import { EchoUpstreamAdapter } from '../../../src/main/contexts/apiProxy/infrastructure/adapters/echo/echo-adapter'
import type { CanonicalRequest, CanonicalStreamEvent } from '../../../src/main/contexts/apiProxy/domain/canonical'

const adapter = new EchoUpstreamAdapter()

function req(text: string, model = 'echo-1'): CanonicalRequest {
  return { model, messages: [{ role: 'user', content: [{ type: 'text', text }] }], stream: false }
}

describe('EchoUpstreamAdapter', () => {
  it('platform is "echo" and supportsModel matches echo / echo-*', () => {
    expect(adapter.platform).toBe('echo')
    expect(adapter.supportsModel('echo')).toBe(true)
    expect(adapter.supportsModel('echo-1')).toBe(true)
    expect(adapter.supportsModel('echo-mini')).toBe(true)
    expect(adapter.supportsModel('claude-sonnet-4.5')).toBe(false)
  })

  it('listModels returns the echo models', () => {
    expect(adapter.listModels().map((m) => m.id)).toEqual(['echo-1', 'echo-mini'])
  })

  it('chat echoes the last user text with fixed usage + end_turn', async () => {
    const resp = await adapter.chat(req('hello world'), {})
    expect(resp.model).toBe('echo-1')
    expect(resp.content).toEqual([{ type: 'text', text: 'hello world' }])
    expect(resp.stopReason).toBe('end_turn')
    expect(resp.usage).toEqual({ inputTokens: 'hello world'.length, outputTokens: 'hello world'.length })
  })

  it('chat picks the LAST user message text', async () => {
    const ir: CanonicalRequest = {
      model: 'echo-1',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'first' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'reply' }] },
        { role: 'user', content: [{ type: 'text', text: 'second' }] },
      ],
      stream: false,
    }
    const resp = await adapter.chat(ir, {})
    expect(resp.content).toEqual([{ type: 'text', text: 'second' }])
  })

  it('chatStream yields text_delta then usage then message_stop (deterministic)', async () => {
    const events: CanonicalStreamEvent[] = []
    for await (const ev of adapter.chatStream(req('hi'), {})) events.push(ev)
    expect(events).toEqual([
      { type: 'text_delta', text: 'hi' },
      { type: 'usage', usage: { inputTokens: 2, outputTokens: 2 } },
      { type: 'message_stop', stopReason: 'end_turn' },
    ])
  })

  it('chat is deterministic — no Date.now/random in output', async () => {
    const a = await adapter.chat(req('same'), {})
    const b = await adapter.chat(req('same'), {})
    expect(a).toEqual(b)
  })
})
