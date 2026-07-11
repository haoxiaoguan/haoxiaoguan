import { describe, it, expect } from 'vitest'
import {
  supportsCursorModel,
  mapCursorModelId,
  isComposerModel,
  listCursorModels,
} from '../../../src/main/contexts/apiProxy/infrastructure/adapters/cursor/cursor-model-map'
import { mapCanonicalToCursor } from '../../../src/main/contexts/apiProxy/infrastructure/adapters/cursor/cursor-request-mapper'
import type { CanonicalRequest } from '../../../src/main/contexts/apiProxy/domain/canonical'

function req(partial: Partial<CanonicalRequest>): CanonicalRequest {
  return { model: 'claude-4.5-sonnet', messages: [], stream: false, ...partial }
}

describe('cursor-model-map', () => {
  it('recognizes cursor-named models, rejects kiro-named ones', () => {
    expect(supportsCursorModel('claude-4.5-sonnet')).toBe(true)
    expect(supportsCursorModel('gpt-5.2')).toBe(true)
    expect(supportsCursorModel('gemini-3-flash-preview')).toBe(true)
    expect(supportsCursorModel('kimi-k2.5')).toBe(true)
    expect(supportsCursorModel('default')).toBe(true)
    // kiro uses version-last naming — must NOT be stolen by cursor
    expect(supportsCursorModel('claude-sonnet-4.5')).toBe(false)
    expect(supportsCursorModel('random-model')).toBe(false)
    expect(supportsCursorModel('')).toBe(false)
  })

  it('maps known ids through, passes cursor-shaped unknowns, falls back to default', () => {
    expect(mapCursorModelId('claude-4.5-sonnet')).toBe('claude-4.5-sonnet')
    expect(mapCursorModelId('CLAUDE-4.5-Sonnet')).toBe('claude-4.5-sonnet')
    // cursor-shaped but not in list → passthrough (tolerate new upstream models)
    expect(mapCursorModelId('claude-4.9-experimental')).toBe('claude-4.9-experimental')
    // fully unknown → default (never throws)
    expect(mapCursorModelId('gpt-4o')).toBe('default')
    expect(mapCursorModelId('')).toBe('default')
  })

  it('detects composer models', () => {
    expect(isComposerModel('composer-1')).toBe(true)
    expect(isComposerModel('cu/composer')).toBe(true)
    expect(isComposerModel('claude-4.5-sonnet')).toBe(false)
  })

  it('lists models for /v1/models with thinking flag', () => {
    const models = listCursorModels()
    expect(models.find((m) => m.id === 'claude-4.5-sonnet')).toBeDefined()
    expect(models.find((m) => m.id === 'claude-4.5-sonnet-thinking')?.supportsThinking).toBe(true)
    expect(models.every((m) => m.ownedBy === 'cursor')).toBe(true)
  })
})

describe('cursor-request-mapper', () => {
  it('folds system into a leading [System Instructions] user message', () => {
    const shape = mapCanonicalToCursor(
      req({ system: 'be terse', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] }),
    )
    expect(shape.messages[0]).toEqual({ role: 'user', content: '[System Instructions]\nbe terse' })
    expect(shape.messages[1]).toEqual({ role: 'user', content: 'hi' })
  })

  it('joins text blocks and preserves roles', () => {
    const shape = mapCanonicalToCursor(
      req({
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] },
          { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
        ],
      }),
    )
    // 同一消息内多个 text 块以 '\n' 连接（对齐 9router user-array 路径 parts.join('\n')）。
    expect(shape.messages).toEqual([
      { role: 'user', content: 'a\nb' },
      { role: 'assistant', content: 'ok' },
    ])
  })

  it('renders tool_result as <tool_result> XML with the tool name from the prior tool_use', () => {
    const shape = mapCanonicalToCursor(
      req({
        messages: [
          { role: 'assistant', content: [{ type: 'tool_use', id: 'call_1', name: 'Read', input: {} }] },
          {
            role: 'user',
            content: [{ type: 'tool_result', toolUseId: 'call_1', content: [{ type: 'text', text: 'file body' }] }],
          },
        ],
      }),
    )
    // assistant with only tool_use → skipped (empty content)
    expect(shape.messages).toHaveLength(1)
    const xml = shape.messages[0].content
    expect(xml).toContain('<tool_name>Read</tool_name>')
    expect(xml).toContain('<tool_call_id>call_1</tool_call_id>')
    expect(xml).toContain('<result>file body</result>')
  })

  it('escapes XML special chars and strips control chars in tool results', () => {
    const shape = mapCanonicalToCursor(
      req({
        messages: [
          {
            role: 'user',
            content: [
              { type: 'tool_result', toolUseId: 'x', content: [{ type: 'text', text: 'a<b>&cd' }] },
            ],
          },
        ],
      }),
    )
    expect(shape.messages[0].content).toContain('<result>a&lt;b&gt;&amp;cd</result>')
  })

  it('maps tools to cursor tool defs and thinking to reasoning effort', () => {
    const shape = mapCanonicalToCursor(
      req({
        messages: [{ role: 'user', content: [{ type: 'text', text: 'go' }] }],
        tools: [{ name: 'Write', description: 'writes', inputSchema: { type: 'object' } }],
        thinking: { type: 'enabled' },
      }),
    )
    expect(shape.tools).toEqual([{ name: 'Write', description: 'writes', input_schema: { type: 'object' } }])
    expect(shape.reasoningEffort).toBe('high')
  })

  it('drops thinking/image blocks (text-only cursor path)', () => {
    const shape = mapCanonicalToCursor(
      req({
        messages: [
          {
            role: 'assistant',
            content: [
              { type: 'thinking', text: 'hmm' },
              { type: 'text', text: 'answer' },
            ],
          },
        ],
      }),
    )
    expect(shape.messages).toEqual([{ role: 'assistant', content: 'answer' }])
  })
})
