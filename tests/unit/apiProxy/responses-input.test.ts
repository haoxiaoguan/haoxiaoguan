import { describe, it, expect } from 'vitest'
import { parseResponsesInput, responsesToIR, responsesCustomToolNames } from '../../../src/main/contexts/apiProxy/infrastructure/inbound/responses/responses-input'
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
  it('内置工具(local_shell/web_search,无 name)被丢弃、不抛；function 工具保留（修复 Codex「完全访问」HTTP 500）', () => {
    const req = {
      model: 'm', input: 'hi', stream: false,
      tools: [
        { type: 'local_shell' },
        { type: 'web_search' },
        { type: 'function', name: 'shell', parameters: { type: 'object' } },
      ],
    } as unknown as ResponsesRequest
    const ir = responsesToIR(req, {})
    expect(ir.tools).toHaveLength(1)
    expect(ir.tools?.[0].name).toBe('shell')
  })
  it('仅内置工具(全无 name) → tools 省略，不抛、不发空 name 工具', () => {
    const req = { model: 'm', input: 'hi', stream: false, tools: [{ type: 'local_shell' }, { type: 'web_search' }] } as unknown as ResponsesRequest
    const ir = responsesToIR(req, {})
    expect((ir.tools ?? []).length).toBe(0)
  })
  it('custom(freeform)工具 → 单 input 字段 function，原定义嵌入 description', () => {
    const req = {
      model: 'm', input: 'hi', stream: false,
      tools: [{ type: 'custom', name: 'apply_patch', description: 'edit files', format: { type: 'grammar' } }],
    } as unknown as ResponsesRequest
    const ir = responsesToIR(req, {})
    expect(ir.tools).toHaveLength(1)
    const tool = ir.tools![0]
    expect(tool.name).toBe('apply_patch')
    expect(tool.inputSchema).toEqual({
      type: 'object',
      properties: { input: { type: 'string', description: 'Raw string input for the original custom tool. Preserve formatting exactly and follow the original tool definition embedded in the description.' } },
      required: ['input'],
    })
    expect(tool.description).toContain('Original tool definition:')
    expect(tool.description).toContain('apply_patch') // 原定义嵌入
  })
  it('responsesCustomToolNames 只收 custom 工具名（function/内置不算）', () => {
    const req = {
      model: 'm', input: 'x',
      tools: [{ type: 'custom', name: 'apply_patch' }, { type: 'function', name: 'shell' }, { type: 'web_search' }],
    } as unknown as ResponsesRequest
    expect([...responsesCustomToolNames(req)]).toEqual(['apply_patch'])
  })
  it('输入项 custom_tool_call → assistant tool_call(arguments={input})；custom_tool_call_output → tool message', () => {
    const msgs = parseResponsesInput([
      { type: 'custom_tool_call', call_id: 'c1', name: 'apply_patch', input: '*** Begin Patch' },
      { type: 'custom_tool_call_output', call_id: 'c1', output: 'done' },
    ])
    expect(msgs[0].role).toBe('assistant')
    expect(msgs[0].tool_calls?.[0].function.name).toBe('apply_patch')
    expect(JSON.parse(msgs[0].tool_calls![0].function.arguments)).toEqual({ input: '*** Begin Patch' })
    expect(msgs[1].role).toBe('tool')
    expect(msgs[1].tool_call_id).toBe('c1')
  })
  it('tool_choice 透传：custom/function 强制 → ir.toolChoice {type:tool,name}；auto→auto；无工具不发', () => {
    const custom = { model: 'm', input: 'x', tools: [{ type: 'custom', name: 'apply_patch' }], tool_choice: { type: 'custom', name: 'apply_patch' } } as unknown as ResponsesRequest
    expect(responsesToIR(custom, {}).toolChoice).toEqual({ type: 'tool', name: 'apply_patch' })
    const fn = { model: 'm', input: 'x', tools: [{ type: 'function', name: 'shell' }], tool_choice: { type: 'function', name: 'shell' } } as unknown as ResponsesRequest
    expect(responsesToIR(fn, {}).toolChoice).toEqual({ type: 'tool', name: 'shell' })
    const auto = { model: 'm', input: 'x', tools: [{ type: 'function', name: 'shell' }], tool_choice: 'auto' } as unknown as ResponsesRequest
    expect(responsesToIR(auto, {}).toolChoice).toEqual({ type: 'auto' })
    // 无工具 → 不发 tool_choice(避免上游对 required/指定工具报错)
    const noTools = { model: 'm', input: 'x', tool_choice: 'required' } as unknown as ResponsesRequest
    expect(responsesToIR(noTools, {}).toolChoice).toBeUndefined()
  })
})
