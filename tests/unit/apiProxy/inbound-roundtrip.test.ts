// 往返一致性测试（cross-protocol round-trip）。
// 用同一组 IR fixture 喂三协议出站序列化，断言三协议对同一语义产出结构正确且彼此等价的结果；
// 再对「协议 → IR」方向做 fixture 驱动断言。覆盖：纯 text、tool_use、image、多轮对话各一例。
// 本文件是「6 转换器对齐同一 IR 契约」的最终守门人——任何转换器偏离不变量都会在这里失败。
// 仅消费 Task 2–5 的导出函数，绝不修改任何转换器/IR 实现。静态 import，禁动态 import()。
import { describe, it, expect } from 'vitest'
import type {
  CanonicalRequest,
  CanonicalResponse,
} from '../../../src/main/contexts/apiProxy/domain/canonical'
import { openaiToIR, irToOpenAIResponse } from '../../../src/main/contexts/apiProxy/infrastructure/inbound/openai'
import { anthropicToIR, irToAnthropicResponse } from '../../../src/main/contexts/apiProxy/infrastructure/inbound/anthropic'
import { geminiToIR, irToGeminiResponse } from '../../../src/main/contexts/apiProxy/infrastructure/inbound/gemini'

// ---- 共享 IR fixtures ----
const textResp: CanonicalResponse = {
  model: 'm',
  content: [{ type: 'text', text: 'The answer is 42.' }],
  stopReason: 'end_turn',
  usage: { inputTokens: 12, outputTokens: 5 },
}

const toolUseResp: CanonicalResponse = {
  model: 'm',
  content: [{ type: 'tool_use', id: 'call_1', name: 'get_weather', input: { city: 'SF', unit: 'c' } }],
  stopReason: 'tool_use',
  usage: { inputTokens: 8, outputTokens: 3 },
}

describe('IR → 三协议响应：结构与语义一致', () => {
  it('text 响应：三协议都承载相同文本与等价 usage 总量', () => {
    const oa = irToOpenAIResponse(textResp, { id: 'a', created: 0 })
    const an = irToAnthropicResponse(textResp, { id: 'b' })
    const ge = irToGeminiResponse(textResp)

    // 文本
    expect(oa.choices[0].message.content).toBe('The answer is 42.')
    expect(an.content[0]).toEqual({ type: 'text', text: 'The answer is 42.' })
    expect(ge.candidates[0].content.parts[0]).toEqual({ text: 'The answer is 42.' })

    // usage 输入/输出 token 等价（字段名不同，数值一致）
    expect(oa.usage.prompt_tokens).toBe(12)
    expect(an.usage.input_tokens).toBe(12)
    expect(ge.usageMetadata.promptTokenCount).toBe(12)
    expect(oa.usage.completion_tokens).toBe(5)
    expect(an.usage.output_tokens).toBe(5)
    expect(ge.usageMetadata.candidatesTokenCount).toBe(5)

    // 停止语义一致：end_turn
    expect(oa.choices[0].finish_reason).toBe('stop')
    expect(an.stop_reason).toBe('end_turn')
    expect(ge.candidates[0].finishReason).toBe('STOP')
  })

  it('tool_use 响应：三协议都产出同名工具调用与同一入参', () => {
    const oa = irToOpenAIResponse(toolUseResp, { id: 'a', created: 0 })
    const an = irToAnthropicResponse(toolUseResp, { id: 'b' })
    const ge = irToGeminiResponse(toolUseResp)

    // OpenAI：arguments 是 JSON 字符串，parse 回来比对
    expect(oa.choices[0].message.tool_calls?.[0].function.name).toBe('get_weather')
    expect(JSON.parse(oa.choices[0].message.tool_calls![0].function.arguments)).toEqual({ city: 'SF', unit: 'c' })
    // Anthropic：input 是对象
    expect(an.content[0]).toEqual({ type: 'tool_use', id: 'call_1', name: 'get_weather', input: { city: 'SF', unit: 'c' } })
    // Gemini：functionCall.args 是对象
    expect(ge.candidates[0].content.parts[0]).toEqual({ functionCall: { name: 'get_weather', args: { city: 'SF', unit: 'c' } } })

    // 停止语义一致：tool_use
    expect(oa.choices[0].finish_reason).toBe('tool_calls')
    expect(an.stop_reason).toBe('tool_use')
    expect(ge.candidates[0].finishReason).toBe('STOP') // Gemini 无独立 tool 停止枚举，归 STOP（不变量 6）
  })
})

describe('三协议请求 → IR：同一语义收敛到同一 IR 形状', () => {
  // 同一段对话（system + 一问 + 多模态图片 + 多轮）在三协议各自表达，断言 IR 收敛一致的关键字段。
  it('text + image 多模态：三协议都收敛出 user[text,image] + 相同 system', () => {
    const oaIR = openaiToIR({
      model: 'm',
      messages: [
        { role: 'system', content: 'sys' },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'see this' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } },
          ],
        },
      ],
    })
    const anIR = anthropicToIR({
      model: 'm',
      max_tokens: 1,
      system: 'sys',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'see this' },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } },
          ],
        },
      ],
    })
    const geIR = geminiToIR(
      {
        systemInstruction: { parts: [{ text: 'sys' }] },
        contents: [
          { role: 'user', parts: [{ text: 'see this' }, { inlineData: { mimeType: 'image/png', data: 'QUJD' } }] },
        ],
      },
      'm',
    )

    const expectedContent = [
      { type: 'text', text: 'see this' },
      { type: 'image', mediaType: 'image/png', data: 'QUJD' },
    ]
    for (const ir of [oaIR, anIR, geIR] as CanonicalRequest[]) {
      expect(ir.system).toBe('sys')
      expect(ir.messages).toHaveLength(1)
      expect(ir.messages[0]).toEqual({ role: 'user', content: expectedContent })
    }
  })

  it('多轮 + 工具：三协议都收敛出 user→assistant(tool_use)→user(tool_result) 同构序列', () => {
    const oaIR = openaiToIR({
      model: 'm',
      messages: [
        { role: 'user', content: 'weather?' },
        { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"SF"}' } }] },
        { role: 'tool', tool_call_id: 'call_1', content: 'sunny' },
      ],
    })
    const anIR = anthropicToIR({
      model: 'm',
      max_tokens: 1,
      messages: [
        { role: 'user', content: 'weather?' },
        { role: 'assistant', content: [{ type: 'tool_use', id: 'call_1', name: 'get_weather', input: { city: 'SF' } }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'sunny' }] },
      ],
    })

    const expectedSeq = [
      { role: 'user', content: [{ type: 'text', text: 'weather?' }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'call_1', name: 'get_weather', input: { city: 'SF' } }] },
      { role: 'user', content: [{ type: 'tool_result', toolUseId: 'call_1', content: [{ type: 'text', text: 'sunny' }] }] },
    ]
    expect(oaIR.messages).toEqual(expectedSeq)
    expect(anIR.messages).toEqual(expectedSeq)

    // Gemini 工具结果用合成 id（gemini-<name>），单独断言其同构（id 规则差异是协议固有）
    const geIR = geminiToIR(
      {
        contents: [
          { role: 'user', parts: [{ text: 'weather?' }] },
          { role: 'model', parts: [{ functionCall: { name: 'get_weather', args: { city: 'SF' } } }] },
          { role: 'user', parts: [{ functionResponse: { name: 'get_weather', response: { text: 'sunny' } } }] },
        ],
      },
      'm',
    )
    expect(geIR.messages[1].content[0]).toEqual({ type: 'tool_use', id: 'gemini-get_weather', name: 'get_weather', input: { city: 'SF' } })
    expect(geIR.messages[2].content[0]).toEqual({
      type: 'tool_result',
      toolUseId: 'gemini-get_weather',
      content: [{ type: 'text', text: JSON.stringify({ text: 'sunny' }) }],
    })
  })
})
