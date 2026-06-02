import { describe, it, expect } from 'vitest'
import { normalizeToolHistory, irMessagesToKiroHistory } from '../../../src/main/contexts/apiProxy/infrastructure/adapters/kiro/kiro-conversation'
import { buildConversationState } from '../../../src/main/contexts/apiProxy/infrastructure/adapters/kiro/kiro-conversation-state'
import type { KiroHistoryMessage, BuildConversationStateOpts } from '../../../src/main/contexts/apiProxy/infrastructure/adapters/kiro/kiro-wire-types'
import type { CanonicalRequest } from '../../../src/main/contexts/apiProxy/domain/canonical'

const HISTORY_WITH_TOOL: KiroHistoryMessage[] = [
  { userInputMessage: { content: 'check weather' } },
  { assistantResponseMessage: { content: 'sure', toolUses: [{ toolUseId: 'tu_1', name: 'get_weather', input: { city: 'SF' } }] } },
  { userInputMessage: { content: '', userInputMessageContext: { toolResults: [{ toolUseId: 'tu_1', content: [{ text: '72F' }], status: 'success' }] } } },
]

describe('normalizeToolHistory', () => {
  it('flattens tool_use/tool_result to text when a tool is NOT declared', () => {
    const out = normalizeToolHistory(HISTORY_WITH_TOOL, new Set<string>()) // 工具均未声明
    // assistant 结构化 toolUses 被清除，input 拍平进 content。
    const assist = out[1].assistantResponseMessage!
    expect(assist.toolUses).toBeUndefined()
    expect(assist.content).toContain('<tool_use id="tu_1" name="get_weather">')
    expect(assist.content).toContain('{"city":"SF"}')
    expect(assist.content).toContain('</tool_use>')
    // user 结构化 toolResults 被清除，文本拍平进 content。
    const user = out[2].userInputMessage!
    expect(user.userInputMessageContext?.toolResults).toBeUndefined()
    expect(user.content).toContain('<tool_result id="tu_1" status="success">')
    expect(user.content).toContain('72F')
  })

  it('keeps structured tool_use/tool_result when the tool IS declared (no-op)', () => {
    const out = normalizeToolHistory(HISTORY_WITH_TOOL, new Set(['get_weather']))
    expect(out).toBe(HISTORY_WITH_TOOL) // 引用透传（同一数组）
    expect(out[1].assistantResponseMessage?.toolUses?.[0].toolUseId).toBe('tu_1')
  })

  it('preserves leading content when flattening (flattenContent join)', () => {
    const out = normalizeToolHistory(HISTORY_WITH_TOOL, new Set<string>())
    expect(out[1].assistantResponseMessage!.content.startsWith('sure\n\n<tool_use')).toBe(true)
  })
})

describe('buildConversationState integrates normalizeToolHistory', () => {
  const OPTS: BuildConversationStateOpts = { modelId: 'claude-sonnet-4.5', origin: 'AI_EDITOR', conversationId: 'c1' }

  it('flattens history tool calls when ir.tools does not declare them', () => {
    const ir: CanonicalRequest = {
      model: 'claude-sonnet-4.5',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'weather?' }] },
        { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_x', name: 'ghost_tool', input: { a: 1 } }] },
        { role: 'user', content: [{ type: 'tool_result', toolUseId: 'tu_x', content: [{ type: 'text', text: 'ok' }] }] },
        { role: 'user', content: [{ type: 'text', text: 'thanks' }] },
      ],
      stream: false, // 无 tools 声明 → ghost_tool 未声明 → 拍平
    }
    const env = buildConversationState(ir, OPTS)
    const history = env.conversationState.history ?? []
    for (const h of history) {
      expect(h.assistantResponseMessage?.toolUses).toBeUndefined()
      expect(h.userInputMessage?.userInputMessageContext?.toolResults).toBeUndefined()
    }
    const assist = history.find((h) => h.assistantResponseMessage?.content.includes('<tool_use'))
    expect(assist).toBeDefined()
  })

  it('keeps structured history tool calls when ir.tools declares them', () => {
    const ir: CanonicalRequest = {
      model: 'claude-sonnet-4.5',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'weather?' }] },
        { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_y', name: 'get_weather', input: { c: 'SF' } }] },
        { role: 'user', content: [{ type: 'tool_result', toolUseId: 'tu_y', content: [{ type: 'text', text: '72F' }] }] },
        { role: 'user', content: [{ type: 'text', text: 'thanks' }] },
      ],
      tools: [{ name: 'get_weather', inputSchema: { type: 'object' } }],
      stream: false,
    }
    const env = buildConversationState(ir, OPTS)
    const history = env.conversationState.history ?? []
    const assist = history.find((h) => h.assistantResponseMessage?.toolUses?.length)
    expect(assist?.assistantResponseMessage?.toolUses?.[0]).toEqual({ toolUseId: 'tu_y', name: 'get_weather', input: { c: 'SF' } })
  })
})

// 烟雾测试：M3a 既有 irMessagesToKiroHistory 仍可用（确保没改坏导出）。
describe('irMessagesToKiroHistory still exported', () => {
  it('maps a single user message', () => {
    const h = irMessagesToKiroHistory([{ role: 'user', content: [{ type: 'text', text: 'hi' }] }])
    expect(h[0].userInputMessage?.content).toBe('hi')
  })
})
