import { describe, it, expect } from 'vitest'
import { parseResponsesInput, responsesToIR } from '../../../src/main/contexts/apiProxy/infrastructure/inbound/responses/responses-input'
import type { ResponsesRequest } from '../../../src/main/contexts/apiProxy/infrastructure/inbound/responses/responses-types'

describe('parseResponsesInput', () => {
  it('string → 单条 user 消息', () => {
    expect(parseResponsesInput('Hello')).toEqual([{ role: 'user', content: 'Hello' }])
  })
  it('messages 数组直传', () => {
    expect(parseResponsesInput([{ role: 'user', content: 'hi' }])).toEqual([{ role: 'user', content: 'hi' }])
  })
  it('typed items: function_call + function_call_output 配对', () => {
    const msgs = parseResponsesInput([
      { type: 'function_call', call_id: 'c1', name: 'get_weather', arguments: '{"q":"x"}' },
      { type: 'function_call_output', call_id: 'c1', output: 'sunny' },
    ])
    expect(msgs[0].role).toBe('assistant')
    expect(msgs[0].tool_calls?.[0].id).toBe('c1')
    expect(msgs[1]).toEqual({ role: 'tool', content: 'sunny', tool_call_id: 'c1' })
  })
})

describe('responsesToIR', () => {
  it('instructions → system；input → messages', () => {
    const req: ResponsesRequest = { model: 'gpt-4.1', input: 'Hi', instructions: 'Be brief.', stream: false }
    const ir = responsesToIR(req, {})
    expect(ir.model).toBe('gpt-4.1')
    expect(ir.system).toBe('Be brief.')
    expect(ir.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }])
  })
  it('history 前缀拼在 input 之前', () => {
    const req: ResponsesRequest = { model: 'm', input: 'now', stream: false }
    const ir = responsesToIR(req, { historyMessages: [{ role: 'user', content: 'before' }, { role: 'assistant', content: 'ok' }] })
    expect(ir.messages.length).toBe(3)
  })
  it('扁平 tools → IR ToolDef；max_output_tokens → maxTokens', () => {
    const req: ResponsesRequest = { model: 'm', input: 'x', stream: false, max_output_tokens: 50, tools: [{ type: 'function', name: 'f', description: 'd', parameters: { type: 'object' } }] }
    const ir = responsesToIR(req, {})
    expect(ir.maxTokens).toBe(50)
    expect(ir.tools?.[0]).toEqual({ name: 'f', description: 'd', inputSchema: { type: 'object' } })
  })
})
