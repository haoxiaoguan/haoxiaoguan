import { describe, it, expect } from 'vitest'
import { serializeResponsesStream } from '../../../src/main/contexts/apiProxy/infrastructure/inbound/responses/responses-stream'
import type { CanonicalResponse, CanonicalStreamEvent } from '../../../src/main/contexts/apiProxy/domain/canonical'

const RESP: CanonicalResponse = { model: 'm', content: [], stopReason: 'end_turn', usage: { inputTokens: 10, outputTokens: 0 } }
const OPTS = { id: 'resp_1', itemId: (i: number) => `item_${i}`, createdAt: 0 }

describe('serializeResponsesStream', () => {
  it('文本流：created→output_item.added(message)→content_part.added→output_text.delta→completed→[DONE]', () => {
    const events: CanonicalStreamEvent[] = [
      { type: 'text_delta', text: 'Hi' },
      { type: 'usage', usage: { inputTokens: 10, outputTokens: 1 } },
      { type: 'message_stop', stopReason: 'end_turn' },
    ]
    const frames = serializeResponsesStream(RESP, events, OPTS)
    const joined = frames.join('')
    expect(joined).toContain('event: response.created')
    expect(joined).toContain('event: response.output_item.added')
    expect(joined).toContain('event: response.content_part.added')
    expect(joined).toContain('event: response.output_text.delta')
    expect(joined).toContain('event: response.completed')
    expect(frames[frames.length - 1]).toBe('data: [DONE]\n\n')
  })
  it('工具流：function_call item + function_call_arguments.delta', () => {
    const events: CanonicalStreamEvent[] = [
      { type: 'tool_use_start', index: 0, id: 'c1', name: 'f' },
      { type: 'tool_use_delta', index: 0, partialJson: '{"a":1}' },
      { type: 'message_stop', stopReason: 'tool_use' },
    ]
    const joined = serializeResponsesStream(RESP, events, OPTS).join('')
    expect(joined).toContain('"type":"function_call"')
    expect(joined).toContain('event: response.function_call_arguments.delta')
  })
})
