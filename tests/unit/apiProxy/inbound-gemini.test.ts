import { describe, it, expect } from 'vitest'
import {
  geminiToIR,
  irToGeminiResponse,
  serializeGeminiStream,
} from '../../../src/main/contexts/apiProxy/infrastructure/inbound/gemini'

describe('geminiToIR', () => {
  it('systemInstruction → system；contents text；model 来自参数', () => {
    const ir = geminiToIR(
      {
        systemInstruction: { parts: [{ text: 'be brief' }] },
        contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
        generationConfig: { maxOutputTokens: 100, temperature: 0.5, topP: 0.8 },
      },
      'gemini-2.5-pro',
    )
    expect(ir.model).toBe('gemini-2.5-pro')
    expect(ir.system).toBe('be brief')
    expect(ir.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'hello' }] }])
    expect(ir.maxTokens).toBe(100)
    expect(ir.temperature).toBe(0.5)
    expect(ir.topP).toBe(0.8)
    expect(ir.stream).toBe(false)
  })

  it('role model ↔ assistant', () => {
    const ir = geminiToIR(
      { contents: [{ role: 'model', parts: [{ text: 'hi from model' }] }] },
      'm',
    )
    expect(ir.messages[0].role).toBe('assistant')
  })

  it('functionCall → ToolUseBlock（id 用 gemini-<name> 兜底）', () => {
    const ir = geminiToIR(
      {
        contents: [
          { role: 'model', parts: [{ functionCall: { name: 'get_weather', args: { city: 'SF' } } }] },
        ],
      },
      'm',
    )
    expect(ir.messages[0].content[0]).toEqual({
      type: 'tool_use',
      id: 'gemini-get_weather',
      name: 'get_weather',
      input: { city: 'SF' },
    })
  })

  it('functionResponse → ToolResultBlock；inlineData → ImageBlock', () => {
    const ir = geminiToIR(
      {
        contents: [
          {
            role: 'user',
            parts: [
              { functionResponse: { name: 'get_weather', response: { temp: 20 } } },
              { inlineData: { mimeType: 'image/png', data: 'QUJD' } },
            ],
          },
        ],
      },
      'm',
    )
    expect(ir.messages[0].content[0]).toEqual({
      type: 'tool_result',
      toolUseId: 'gemini-get_weather',
      content: [{ type: 'text', text: JSON.stringify({ temp: 20 }) }],
    })
    expect(ir.messages[0].content[1]).toEqual({ type: 'image', mediaType: 'image/png', data: 'QUJD' })
  })

  it('tools.functionDeclarations → ToolDef', () => {
    const ir = geminiToIR(
      {
        contents: [],
        tools: [
          {
            functionDeclarations: [
              { name: 'f', description: 'do f', parameters: { type: 'object' } },
            ],
          },
        ],
      },
      'm',
    )
    expect(ir.tools).toEqual([{ name: 'f', description: 'do f', inputSchema: { type: 'object' } }])
  })

  it('systemInstruction 字符串形态也支持', () => {
    const ir = geminiToIR({ contents: [], systemInstruction: { parts: [{ text: 'x' }, { text: 'y' }] } }, 'm')
    expect(ir.system).toBe('x\ny')
  })
})

describe('irToGeminiResponse', () => {
  it('text → candidates[0].content.parts；end_turn → STOP；usage → usageMetadata', () => {
    const out = irToGeminiResponse({
      model: 'gemini-2.5-pro',
      content: [{ type: 'text', text: 'hello' }],
      stopReason: 'end_turn',
      usage: { inputTokens: 4, outputTokens: 2 },
    })
    expect(out.candidates[0].content.role).toBe('model')
    expect(out.candidates[0].content.parts).toEqual([{ text: 'hello' }])
    expect(out.candidates[0].finishReason).toBe('STOP')
    expect(out.usageMetadata).toEqual({
      promptTokenCount: 4,
      candidatesTokenCount: 2,
      totalTokenCount: 6,
    })
  })

  it('tool_use → functionCall part；max_tokens → MAX_TOKENS；cacheRead → cachedContentTokenCount', () => {
    const out = irToGeminiResponse({
      model: 'm',
      content: [{ type: 'tool_use', id: 'x', name: 'get_weather', input: { city: 'SF' } }],
      stopReason: 'max_tokens',
      usage: { inputTokens: 10, outputTokens: 1, cacheReadTokens: 3 },
    })
    expect(out.candidates[0].content.parts).toEqual([
      { functionCall: { name: 'get_weather', args: { city: 'SF' } } },
    ])
    expect(out.candidates[0].finishReason).toBe('MAX_TOKENS')
    expect(out.usageMetadata.cachedContentTokenCount).toBe(3)
  })
})

describe('serializeGeminiStream', () => {
  it('text 增量逐 chunk；末 chunk 带 finishReason；usage → 末 chunk usageMetadata', () => {
    const chunks = serializeGeminiStream([
      { type: 'text_delta', text: 'He' },
      { type: 'text_delta', text: 'llo' },
      { type: 'usage', usage: { inputTokens: 4, outputTokens: 2 } },
      { type: 'message_stop', stopReason: 'end_turn' },
    ])
    const objs = chunks.map((c) => JSON.parse(c)) as Array<{
      candidates: { content: { parts: { text?: string }[] }; finishReason?: string }[]
      usageMetadata?: { candidatesTokenCount: number }
    }>
    // 两个文本 chunk
    expect(objs[0].candidates[0].content.parts[0].text).toBe('He')
    expect(objs[1].candidates[0].content.parts[0].text).toBe('llo')
    // 末 chunk 携带 finishReason + usageMetadata
    const last = objs[objs.length - 1]
    expect(last.candidates[0].finishReason).toBe('STOP')
    expect(last.usageMetadata?.candidatesTokenCount).toBe(2)
  })

  it('functionCall 流：tool_use_start + delta 累积为一个 functionCall part', () => {
    const chunks = serializeGeminiStream([
      { type: 'tool_use_start', index: 0, id: 'x', name: 'get_weather' },
      { type: 'tool_use_delta', index: 0, partialJson: '{"city":"SF"}' },
      { type: 'message_stop', stopReason: 'tool_use' },
    ])
    const objs = chunks.map((c) => JSON.parse(c)) as Array<{
      candidates: { content: { parts: { functionCall?: { name: string; args: unknown } }[] }; finishReason?: string }[]
    }>
    const fcChunk = objs.find((o) => o.candidates[0].content.parts[0]?.functionCall)
    expect(fcChunk?.candidates[0].content.parts[0].functionCall).toEqual({
      name: 'get_weather',
      args: { city: 'SF' },
    })
  })
})
