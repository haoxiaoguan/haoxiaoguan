import { describe, it, expect } from 'vitest'
import { openaiToIR } from '../../../src/main/contexts/apiProxy/infrastructure/inbound/openai'

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
