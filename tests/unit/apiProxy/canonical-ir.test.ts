import { describe, it, expect } from 'vitest'
import type {
  CanonicalRequest,
  CanonicalResponse,
  CanonicalStreamEvent,
  ContentBlock,
  StopReason,
} from '../../../src/main/contexts/apiProxy/domain/canonical'

// 纯类型模块无运行时导出，这里通过「构造合法值 + 判别」固化契约：
// 1) 类型可被实例化（编译期约束，tsc 在 typecheck 时把关）
// 2) 判别字段值符合不变量（运行期 expect 把关）
describe('Canonical IR shape', () => {
  it('CanonicalRequest 携带 stream 与归一化后的 message content 数组', () => {
    const req: CanonicalRequest = {
      model: 'claude-sonnet-4-5',
      system: 'be concise',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      stream: false,
    }
    expect(req.stream).toBe(false)
    expect(req.messages[0].content[0]).toEqual({ type: 'text', text: 'hi' })
  })

  it('ContentBlock 五种判别值齐备', () => {
    const blocks: ContentBlock[] = [
      { type: 'text', text: 't' },
      { type: 'image', mediaType: 'image/png', data: 'AAAA' },
      { type: 'tool_use', id: 'tu_1', name: 'get_weather', input: { city: 'SF' } },
      { type: 'tool_result', toolUseId: 'tu_1', content: [{ type: 'text', text: 'ok' }] },
      { type: 'thinking', text: 'hmm' },
    ]
    expect(blocks.map((b) => b.type)).toEqual([
      'text',
      'image',
      'tool_use',
      'tool_result',
      'thinking',
    ])
  })

  it('CanonicalResponse.stopReason 取四值枚举之一', () => {
    const stops: StopReason[] = ['end_turn', 'max_tokens', 'tool_use', 'stop_sequence']
    const resp: CanonicalResponse = {
      model: 'm',
      content: [{ type: 'text', text: 'done' }],
      stopReason: 'end_turn',
      usage: { inputTokens: 3, outputTokens: 2 },
    }
    expect(stops).toContain(resp.stopReason)
    expect(resp.usage.inputTokens + resp.usage.outputTokens).toBe(5)
  })

  it('CanonicalStreamEvent 六种判别值齐备', () => {
    const events: CanonicalStreamEvent[] = [
      { type: 'text_delta', text: 'a' },
      { type: 'thinking_delta', text: 'b' },
      { type: 'tool_use_start', index: 0, id: 'tu_1', name: 'f' },
      { type: 'tool_use_delta', index: 0, partialJson: '{"x":1}' },
      { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } },
      { type: 'message_stop', stopReason: 'end_turn' },
    ]
    expect(events.map((e) => e.type)).toEqual([
      'text_delta',
      'thinking_delta',
      'tool_use_start',
      'tool_use_delta',
      'usage',
      'message_stop',
    ])
  })
})
