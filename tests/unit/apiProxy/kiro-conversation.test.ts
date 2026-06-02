import { describe, it, expect } from 'vitest'
import {
  sanitizeConversation,
  irMessagesToKiroHistory,
  truncateToolResultText,
} from '../../../src/main/contexts/apiProxy/infrastructure/adapters/kiro/kiro-conversation'
import type { KiroHistoryMessage } from '../../../src/main/contexts/apiProxy/infrastructure/adapters/kiro/kiro-wire-types'
import type { CanonicalMessage } from '../../../src/main/contexts/apiProxy/domain/canonical'

const U = (content: string): KiroHistoryMessage => ({ userInputMessage: { content } })
const A = (content: string): KiroHistoryMessage => ({ assistantResponseMessage: { content } })
const A_TOOL = (content: string, toolUseId: string, name = 't'): KiroHistoryMessage => ({
  assistantResponseMessage: { content, toolUses: [{ toolUseId, name, input: {} }] },
})
const U_RESULT = (toolUseId: string, text = 'r'): KiroHistoryMessage => ({
  userInputMessage: { content: '', userInputMessageContext: { toolResults: [{ toolUseId, content: [{ text }], status: 'success' }] } },
})

describe('irMessagesToKiroHistory', () => {
  it('maps user/assistant text turns', () => {
    const msgs: CanonicalMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
    ]
    expect(irMessagesToKiroHistory(msgs)).toEqual([
      { userInputMessage: { content: 'hi' } },
      { assistantResponseMessage: { content: 'hello' } },
    ])
  })

  it('maps assistant tool_use into toolUses and user tool_result into toolResults', () => {
    const msgs: CanonicalMessage[] = [
      { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_1', name: 'w', input: { a: 1 } }] },
      { role: 'user', content: [{ type: 'tool_result', toolUseId: 'tu_1', content: [{ type: 'text', text: 'ok' }] }] },
    ]
    const out = irMessagesToKiroHistory(msgs)
    expect(out[0].assistantResponseMessage?.toolUses).toEqual([{ toolUseId: 'tu_1', name: 'w', input: { a: 1 } }])
    expect(out[1].userInputMessage?.userInputMessageContext?.toolResults).toEqual([
      { toolUseId: 'tu_1', content: [{ text: 'ok' }], status: 'success' },
    ])
  })

  it('marks isError tool_result as error status and keeps non-empty content', () => {
    const msgs: CanonicalMessage[] = [
      { role: 'user', content: [{ type: 'tool_result', toolUseId: 'tu_2', content: [], isError: true }] },
    ]
    const out = irMessagesToKiroHistory(msgs)
    const tr = out[0].userInputMessage?.userInputMessageContext?.toolResults?.[0]
    expect(tr?.status).toBe('error')
    expect(tr?.content).toEqual([{ text: ' ' }]) // 空 content 占位为单空格（Kiro 非空要求）
  })
})

describe('sanitizeConversation — start/end/alternation', () => {
  it('prepends a user placeholder when starting with assistant', () => {
    const out = sanitizeConversation([A('hello'), U('hi')])
    expect(out[0].userInputMessage?.content).toBe('Hello')
  })

  it('appends a user placeholder when ending with assistant', () => {
    const out = sanitizeConversation([U('hi'), A('hello')])
    expect(out.at(-1)?.userInputMessage?.content).toBe('Continue')
  })

  it('inserts "understood" between two consecutive user messages', () => {
    const out = sanitizeConversation([U('a'), U('b')])
    // a → understood(assistant) → b → ...(end may append)
    expect(out[0].userInputMessage?.content).toBe('a')
    expect(out[1].assistantResponseMessage?.content).toBe('understood')
    expect(out[2].userInputMessage?.content).toBe('b')
  })

  it('inserts "Continue" between two consecutive assistant messages', () => {
    const out = sanitizeConversation([U('a'), A('x'), A('y')])
    const idx = out.findIndex((m) => m.assistantResponseMessage?.content === 'x')
    expect(out[idx + 1].userInputMessage?.content).toBe('Continue')
    expect(out[idx + 2].assistantResponseMessage?.content).toBe('y')
  })
})

describe('sanitizeConversation — toolUse/toolResult pairing', () => {
  it('keeps a valid toolUse→toolResult pair intact', () => {
    const out = sanitizeConversation([U('q'), A_TOOL('', 'tu_1'), U_RESULT('tu_1'), U('next')])
    const assist = out.find((m) => m.assistantResponseMessage?.toolUses?.length)
    expect(assist?.assistantResponseMessage?.toolUses?.[0].toolUseId).toBe('tu_1')
    const result = out.find((m) => m.userInputMessage?.userInputMessageContext?.toolResults?.length)
    expect(result?.userInputMessage?.userInputMessageContext?.toolResults?.[0].toolUseId).toBe('tu_1')
  })

  it('synthesizes a failed toolResult when an assistant toolUse has no following result', () => {
    const out = sanitizeConversation([U('q'), A_TOOL('', 'tu_orphan'), U('next')])
    // 在 assistant(toolUse) 后应插入一条带失败占位 toolResult 的 user
    const synth = out.find((m) =>
      m.userInputMessage?.userInputMessageContext?.toolResults?.some((tr) => tr.toolUseId === 'tu_orphan'),
    )
    expect(synth).toBeTruthy()
    const tr = synth?.userInputMessage?.userInputMessageContext?.toolResults?.find((t) => t.toolUseId === 'tu_orphan')
    expect(tr?.status).toBe('error')
    expect(tr?.content[0].text).toBe('Tool execution failed')
  })

  it('produces a conversation that passes its own validation (no throw)', () => {
    expect(() => sanitizeConversation([U('q'), A_TOOL('', 'tu_1'), U_RESULT('tu_1')])).not.toThrow()
  })
})

describe('sanitizeConversation — empty content', () => {
  it('drops a non-first empty user message with no toolResults', () => {
    const out = sanitizeConversation([U('a'), A('b'), U('')])
    // 末尾空 user（无 toolResults）应被剔除；剔除后以 assistant 结尾 → 追加 Continue
    expect(out.some((m) => m.userInputMessage?.content === '')).toBe(false)
  })
})

describe('truncateToolResultText', () => {
  it('truncates oversized toolResult text by UTF-8 bytes with a marker', () => {
    const big = 'x'.repeat(100)
    const msgs: KiroHistoryMessage[] = [U_RESULT('tu_1', big)]
    const out = truncateToolResultText(msgs, 20)
    const text = out[0].userInputMessage?.userInputMessageContext?.toolResults?.[0].content[0].text ?? ''
    expect(Buffer.byteLength(text.split('\n\n[')[0], 'utf-8')).toBeLessThanOrEqual(20)
    expect(text).toContain('[Truncated')
  })

  it('leaves small toolResult text unchanged', () => {
    const msgs: KiroHistoryMessage[] = [U_RESULT('tu_1', 'short')]
    const out = truncateToolResultText(msgs, 1000)
    expect(out[0].userInputMessage?.userInputMessageContext?.toolResults?.[0].content[0].text).toBe('short')
  })
})
