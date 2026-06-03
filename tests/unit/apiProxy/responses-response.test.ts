import { describe, it, expect } from 'vitest'
import { irToResponsesResponse } from '../../../src/main/contexts/apiProxy/infrastructure/inbound/responses/responses-response'
import type { CanonicalResponse } from '../../../src/main/contexts/apiProxy/domain/canonical'

const OPTS = { id: 'resp_test', itemId: (i: number) => `item_${i}`, createdAt: 0 }

describe('irToResponsesResponse', () => {
  it('text → message.output_text item', () => {
    const resp: CanonicalResponse = {
      model: 'm',
      content: [{ type: 'text', text: 'Hi' }],
      stopReason: 'end_turn',
      usage: { inputTokens: 10, outputTokens: 2 },
    }
    const r = irToResponsesResponse(resp, OPTS)
    expect(r.id).toBe('resp_test')
    expect(r.output[0].type).toBe('message')
    expect(r.output[0].content?.[0]).toEqual({ type: 'output_text', text: 'Hi' })
    expect(r.usage).toEqual({ input_tokens: 10, output_tokens: 2, total_tokens: 12 })
  })

  it('tool_use → function_call item；cacheRead → cached_tokens', () => {
    const resp: CanonicalResponse = {
      model: 'm',
      content: [{ type: 'tool_use', id: 'c1', name: 'f', input: { a: 1 } }],
      stopReason: 'tool_use',
      usage: { inputTokens: 100, outputTokens: 5, cacheReadTokens: 80 },
    }
    const r = irToResponsesResponse(resp, OPTS)
    const fc = r.output.find((o) => o.type === 'function_call')
    expect(fc?.call_id).toBe('c1')
    expect(fc?.name).toBe('f')
    expect(fc?.arguments).toBe('{"a":1}')
    expect(r.usage.input_tokens_details?.cached_tokens).toBe(80)
  })
})
