import { describe, it, expect } from 'vitest'
import { buildConversationState } from '../../../src/main/contexts/apiProxy/infrastructure/adapters/kiro/kiro-conversation-state'
import { parseKiroEventStream, encodeKiroEventStream } from '../../../src/main/contexts/apiProxy/infrastructure/adapters/kiro/kiro-event-stream'
import { mapModelId } from '../../../src/main/contexts/apiProxy/infrastructure/adapters/kiro/kiro-model-map'
import type { BuildConversationStateOpts } from '../../../src/main/contexts/apiProxy/infrastructure/adapters/kiro/kiro-wire-types'
import type { CanonicalRequest, CanonicalStreamEvent } from '../../../src/main/contexts/apiProxy/domain/canonical'

describe('Kiro integration — request build', () => {
  it('builds a coherent conversationState from a multi-turn IR with tools', () => {
    const ir: CanonicalRequest = {
      model: 'claude-sonnet-4-5', // 破折号，验证调用方先 map
      system: 'You are a coding agent.',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'what is the weather in SF?' }] },
        { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_1', name: 'get_weather', input: { city: 'SF' } }] },
        { role: 'user', content: [{ type: 'tool_result', toolUseId: 'tu_1', content: [{ type: 'text', text: '72F sunny' }] }] },
        { role: 'user', content: [{ type: 'text', text: 'and tomorrow?' }] },
      ],
      tools: [{ name: 'get_weather', description: 'Get weather', inputSchema: { type: 'object', properties: { city: { type: 'string' } } } }],
      maxTokens: 2048,
      temperature: 0.5,
      stream: true,
    }
    const opts: BuildConversationStateOpts = {
      modelId: mapModelId(ir.model), // 'claude-sonnet-4.5'
      origin: 'AI_EDITOR',
      conversationId: 'conv-int-1',
      agentContinuationId: 'cont-int-1',
      profileArn: 'arn:aws:codewhisperer:us-east-1:111122223333:profile/INTEG',
    }
    const env = buildConversationState(ir, opts)

    // 当前消息 = 最后一条 user（'and tomorrow?'），含 system 前缀 + tools。
    const cur = env.conversationState.currentMessage.userInputMessage
    expect(cur.content).toBe('You are a coding agent.\n\nand tomorrow?')
    expect(cur.modelId).toBe('claude-sonnet-4.5')
    expect(cur.origin).toBe('AI_EDITOR')
    expect(cur.userInputMessageContext?.tools?.[0].toolSpecification.name).toBe('get_weather')
    expect(cur.userInputMessageContext?.tools?.[0].toolSpecification.inputSchema.json).toEqual({
      type: 'object', properties: { city: { type: 'string' } },
    })

    // history 含 user(问) → assistant(toolUse) → user(toolResult) 配对；tools 不进 history。
    const history = env.conversationState.history ?? []
    const assistWithTool = history.find((h) => h.assistantResponseMessage?.toolUses?.length)
    expect(assistWithTool?.assistantResponseMessage?.toolUses?.[0]).toEqual({ toolUseId: 'tu_1', name: 'get_weather', input: { city: 'SF' } })
    const userWithResult = history.find((h) => h.userInputMessage?.userInputMessageContext?.toolResults?.length)
    expect(userWithResult?.userInputMessage?.userInputMessageContext?.toolResults?.[0]).toEqual({
      toolUseId: 'tu_1', content: [{ text: '72F sunny' }], status: 'success',
    })
    for (const h of history) expect(h.userInputMessage?.userInputMessageContext?.tools).toBeUndefined()

    // 顶层并列字段。
    expect(env.profileArn).toBe(opts.profileArn)
    expect(env.inferenceConfig).toEqual({ maxTokens: 2048, temperature: 0.5 })
    expect(env.conversationState.conversationId).toBe('conv-int-1')
    expect(env.conversationState.agentContinuationId).toBe('cont-int-1')
    expect(env.conversationState.chatTriggerType).toBe('MANUAL')
  })
})

describe('Kiro integration — stream parse', () => {
  it('parses a thinking+text+tool stream into the expected IR event sequence', () => {
    const bytes = encodeKiroEventStream([
      { eventType: 'reasoningContentEvent', payload: { text: 'reasoning…' } },
      { eventType: 'assistantResponseEvent', payload: { content: 'Let me check. ' } },
      { eventType: 'toolUseEvent', payload: { toolUseId: 'tu_9', name: 'get_weather' } },
      { eventType: 'toolUseEvent', payload: { toolUseId: 'tu_9', input: '{"city":"SF"}' } },
      { eventType: 'toolUseEvent', payload: { toolUseId: 'tu_9', stop: true } },
      { eventType: 'messageMetadataEvent', payload: { tokenUsage: { uncachedInputTokens: 100, cacheReadInputTokens: 20, outputTokens: 30 } } },
    ])
    const events = parseKiroEventStream(bytes)
    expect(events).toEqual<CanonicalStreamEvent[]>([
      { type: 'thinking_delta', text: 'reasoning…' },
      { type: 'text_delta', text: 'Let me check. ' },
      { type: 'tool_use_start', index: 0, id: 'tu_9', name: 'get_weather' },
      { type: 'tool_use_delta', index: 0, partialJson: '{"city":"SF"}' },
      { type: 'usage', usage: { inputTokens: 120, outputTokens: 30, cacheReadTokens: 20 } },
      { type: 'message_stop', stopReason: 'tool_use' },
    ])
  })

  it('parses a plain text stream ending in end_turn', () => {
    const bytes = encodeKiroEventStream([
      { eventType: 'assistantResponseEvent', payload: { content: 'Hello ' } },
      { eventType: 'assistantResponseEvent', payload: { content: 'there.' } },
      { eventType: 'messageMetadataEvent', payload: { tokenUsage: { uncachedInputTokens: 5, outputTokens: 2 } } },
    ])
    expect(parseKiroEventStream(bytes)).toEqual<CanonicalStreamEvent[]>([
      { type: 'text_delta', text: 'Hello ' },
      { type: 'text_delta', text: 'there.' },
      { type: 'usage', usage: { inputTokens: 5, outputTokens: 2 } },
      { type: 'message_stop', stopReason: 'end_turn' },
    ])
  })
})
