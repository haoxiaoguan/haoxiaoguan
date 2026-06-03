import { describe, it, expect } from 'vitest'
import { buildConversationState } from '../../../src/main/contexts/apiProxy/infrastructure/adapters/kiro/kiro-conversation-state'
import type { BuildConversationStateOpts } from '../../../src/main/contexts/apiProxy/infrastructure/adapters/kiro/kiro-wire-types'
import type { CanonicalRequest } from '../../../src/main/contexts/apiProxy/domain/canonical'

const OPTS: BuildConversationStateOpts = {
  modelId: 'claude-sonnet-4.5',
  origin: 'AI_EDITOR',
  conversationId: 'conv-fixed-1',
  profileArn: 'arn:aws:codewhisperer:us-east-1:111122223333:profile/ABCDEF',
}

function simpleReq(text: string): CanonicalRequest {
  return { model: 'claude-sonnet-4-5', messages: [{ role: 'user', content: [{ type: 'text', text }] }], stream: false }
}

describe('buildConversationState — basics', () => {
  it('puts the last user text into currentMessage with injected modelId/origin', () => {
    const env = buildConversationState(simpleReq('hello kiro'), OPTS)
    const cur = env.conversationState.currentMessage.userInputMessage
    expect(cur.content).toBe('hello kiro')
    expect(cur.modelId).toBe('claude-sonnet-4.5')
    expect(cur.origin).toBe('AI_EDITOR')
    expect(env.conversationState.conversationId).toBe('conv-fixed-1')
    expect(env.conversationState.chatTriggerType).toBe('MANUAL')
    expect(env.profileArn).toBe(OPTS.profileArn)
  })

  it('omits history when there is only a single user turn', () => {
    const env = buildConversationState(simpleReq('solo'), OPTS)
    expect(env.conversationState.history).toBeUndefined()
  })

  it('writes agentContinuationId only when provided', () => {
    const withId = buildConversationState(simpleReq('x'), { ...OPTS, agentContinuationId: 'cont-1' })
    expect(withId.conversationState.agentContinuationId).toBe('cont-1')
    const without = buildConversationState(simpleReq('x'), OPTS)
    expect(without.conversationState.agentContinuationId).toBeUndefined()
  })

  it('is deterministic — same input yields identical output (no clock/random)', () => {
    const a = buildConversationState(simpleReq('same'), OPTS)
    const b = buildConversationState(simpleReq('same'), OPTS)
    expect(a).toEqual(b)
  })
})

describe('buildConversationState — inferenceConfig + system + thinking', () => {
  it('emits inferenceConfig from maxTokens/temperature/topP', () => {
    const ir: CanonicalRequest = { ...simpleReq('hi'), maxTokens: 1024, temperature: 0.7, topP: 0.9 }
    const env = buildConversationState(ir, OPTS)
    expect(env.inferenceConfig).toEqual({ maxTokens: 1024, temperature: 0.7, topP: 0.9 })
  })

  it('omits inferenceConfig when no sampling params are set', () => {
    const env = buildConversationState(simpleReq('hi'), OPTS)
    expect(env.inferenceConfig).toBeUndefined()
  })

  it('prepends system text into the current message content', () => {
    const ir: CanonicalRequest = { ...simpleReq('do it'), system: 'You are terse.' }
    const env = buildConversationState(ir, OPTS)
    expect(env.conversationState.currentMessage.userInputMessage.content).toBe('You are terse.\n\ndo it')
  })

  it('injects thinking prefix + additionalModelRequestFields when thinking enabled', () => {
    const ir: CanonicalRequest = { ...simpleReq('think'), thinking: { type: 'enabled', budgetTokens: 4096 } }
    const env = buildConversationState(ir, OPTS)
    const content = env.conversationState.currentMessage.userInputMessage.content
    expect(content.startsWith('<thinking_mode>enabled</thinking_mode>\n<max_thinking_length>4096</max_thinking_length>')).toBe(true)
    expect(content.endsWith('think')).toBe(true)
    expect(env.additionalModelRequestFields).toEqual({ thinking: { type: 'enabled', budget_tokens: 4096 } })
  })

  it('does not inject thinking when disabled/absent', () => {
    const env = buildConversationState(simpleReq('plain'), OPTS)
    expect(env.conversationState.currentMessage.userInputMessage.content).toBe('plain')
    expect(env.additionalModelRequestFields).toBeUndefined()
  })
})

describe('buildConversationState — tools + history', () => {
  it('attaches tools to the CURRENT message only (not history)', () => {
    const ir: CanonicalRequest = {
      model: 'claude-sonnet-4-5',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'first' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
        { role: 'user', content: [{ type: 'text', text: 'now use a tool' }] },
      ],
      tools: [{ name: 'get_weather', description: 'w', inputSchema: { type: 'object', properties: {} } }],
      stream: false,
    }
    const env = buildConversationState(ir, OPTS)
    const cur = env.conversationState.currentMessage.userInputMessage
    expect(cur.userInputMessageContext?.tools).toEqual([
      { toolSpecification: { name: 'get_weather', description: 'w', inputSchema: { json: { type: 'object', properties: {} } } } },
    ])
    // history 不得携带 tools
    for (const h of env.conversationState.history ?? []) {
      expect(h.userInputMessage?.userInputMessageContext?.tools).toBeUndefined()
    }
  })

  it('maps a tool_use/tool_result round into history with matched ids', () => {
    const ir: CanonicalRequest = {
      model: 'claude-sonnet-4-5',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'weather?' }] },
        { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_1', name: 'get_weather', input: { city: 'SF' } }] },
        { role: 'user', content: [{ type: 'tool_result', toolUseId: 'tu_1', content: [{ type: 'text', text: '72F' }] }] },
        { role: 'user', content: [{ type: 'text', text: 'thanks' }] },
      ],
      // M3b：history 的 get_weather 必须在当前请求 tools 中声明，否则 normalizeToolHistory 会把
      // 结构化 toolUse/toolResult 拍平成文本（CodeWhisperer 对未声明工具的结构化 toolUse 返回 400）。
      // 声明后本场景为 no-op，结构化 toolUses/toolResults 原样保留——本用例正是验证该配对路径。
      tools: [{ name: 'get_weather', inputSchema: { type: 'object' } }],
      stream: false,
    }
    const env = buildConversationState(ir, OPTS)
    const history = env.conversationState.history ?? []
    // history 含 assistant.toolUses 与紧邻 user.toolResults
    const assist = history.find((h) => h.assistantResponseMessage?.toolUses?.length)
    expect(assist?.assistantResponseMessage?.toolUses?.[0]).toEqual({ toolUseId: 'tu_1', name: 'get_weather', input: { city: 'SF' } })
    const withResult = history.find((h) => h.userInputMessage?.userInputMessageContext?.toolResults?.length)
    expect(withResult?.userInputMessage?.userInputMessageContext?.toolResults?.[0]).toEqual({
      toolUseId: 'tu_1',
      content: [{ text: '72F' }],
      status: 'success',
    })
  })

  it('maps an IR image block into Kiro image (base64 bytes + short format)', () => {
    const ir: CanonicalRequest = {
      model: 'claude-sonnet-4-5',
      messages: [{ role: 'user', content: [{ type: 'image', mediaType: 'image/png', data: 'AAAA' }, { type: 'text', text: 'look' }] }],
      stream: false,
    }
    const env = buildConversationState(ir, OPTS)
    const cur = env.conversationState.currentMessage.userInputMessage
    expect(cur.images).toEqual([{ format: 'png', source: { bytes: 'AAAA' } }])
    expect(cur.content).toBe('look')
  })

  it('current content falls back to "Continue" when last user has only a tool_result and no tools', () => {
    // 最后一条 user 仅 tool_result（无文本）→ content 空且无 toolResults 挂当前？此处当前=最后一条 user
    const ir: CanonicalRequest = {
      model: 'claude-sonnet-4-5',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'q' }] },
        { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_9', name: 't', input: {} }] },
        { role: 'user', content: [{ type: 'tool_result', toolUseId: 'tu_9', content: [{ type: 'text', text: 'r' }] }] },
      ],
      stream: false,
    }
    const env = buildConversationState(ir, OPTS)
    // 当前消息携带 toolResults → content 允许为 ''（非 'Continue'），由清洗保证非空规则不触发（带 toolResults）
    const cur = env.conversationState.currentMessage.userInputMessage
    expect(cur.userInputMessageContext?.toolResults?.[0].toolUseId).toBe('tu_9')
    expect(cur.content).toBe('')
  })

  it('C2: 当前消息 tool_result 含 image 块时替换为 [image] 占位文本', () => {
    const ir: CanonicalRequest = {
      model: 'claude-sonnet-4-5',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'q' }] },
        { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_img', name: 'screenshot', input: {} }] },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              toolUseId: 'tu_img',
              content: [
                { type: 'image', mediaType: 'image/png', data: 'AAAA' },
                { type: 'text', text: 'caption' },
              ],
            },
          ],
        },
      ],
      stream: false,
    }
    const env = buildConversationState(ir, OPTS)
    const cur = env.conversationState.currentMessage.userInputMessage
    const tr = cur.userInputMessageContext?.toolResults?.[0]
    expect(tr?.toolUseId).toBe('tu_img')
    // image 替换为 [image] 占位，text 保留
    expect(tr?.content[0].text).toBe('[image]\ncaption')
  })

  it('is deterministic across complex inputs with history + tools (no clock/random)', () => {
    const ir: CanonicalRequest = {
      model: 'claude-sonnet-4-5',
      system: 'sys',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'weather?' }] },
        { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_1', name: 'get_weather', input: { city: 'SF' } }] },
        { role: 'user', content: [{ type: 'tool_result', toolUseId: 'tu_1', content: [{ type: 'text', text: '72F' }] }] },
        { role: 'user', content: [{ type: 'text', text: 'thanks' }] },
      ],
      tools: [{ name: 'get_weather', inputSchema: { type: 'object' } }],
      maxTokens: 256,
      thinking: { type: 'enabled', budgetTokens: 2048 },
      stream: false,
    }
    const a = buildConversationState(ir, OPTS)
    const b = buildConversationState(ir, OPTS)
    expect(a).toEqual(b)
  })
})
