import { describe, it, expect } from 'vitest'
import { extractSessionHint } from '../../../src/main/contexts/apiProxy/domain/account-selection/session-hint'

describe('extractSessionHint', () => {
  it('header 最高优先级', () => {
    expect(extractSessionHint({ 'x-claude-code-session-id': 'sess-A' }, {})).toBe('sess-A')
    expect(extractSessionHint({ 'x-conversation-id': 'c1' }, {})).toBe('c1')
  })
  it('header 优先于 body', () => {
    expect(extractSessionHint({ 'x-opencode-session': 'h' }, { session_id: 'b' })).toBe('h')
  })
  it('body 顶层字段（含驼峰）', () => {
    expect(extractSessionHint({}, { prompt_cache_key: 'p' })).toBe('p')
    expect(extractSessionHint({}, { conversationId: 'cc' })).toBe('cc')
    expect(extractSessionHint({}, { thread_id: 't' })).toBe('t')
  })
  it('body.metadata', () => {
    expect(extractSessionHint({}, { metadata: { session_id: 'm' } })).toBe('m')
  })
  it('无显式 hint → 前两条消息指纹（稳定 32 hex）', () => {
    const body = { messages: [{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'hi' }] }
    const h = extractSessionHint({}, body)
    expect(h).toMatch(/^[0-9a-f]{32}$/)
    expect(extractSessionHint({}, body)).toBe(h) // 确定性
  })
  it('无 header/body/消息 → undefined', () => {
    expect(extractSessionHint({}, {})).toBeUndefined()
    expect(extractSessionHint({}, { messages: [] })).toBeUndefined()
  })
  it('clientKeyId 前缀隔离', () => {
    const a = extractSessionHint({ 'x-conversation-id': 'c1' }, {}, 'keyAAAAAAAA')
    expect(a).toBe('keyAAAAA:c1') // 前 8 字符 + ':'
  })
})
