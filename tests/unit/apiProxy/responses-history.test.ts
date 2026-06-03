import { describe, it, expect } from 'vitest'
import { expandPreviousResponseHistory } from '../../../src/main/contexts/apiProxy/infrastructure/responses-store/responses-history'
import type { StoredResponseDoc } from '../../../src/main/contexts/apiProxy/infrastructure/responses-store/responses-store'

function mkDoc(id: string, input: unknown, text: string, prev?: string): StoredResponseDoc {
  return { id, createdAt: 0, status: 'completed', model: 'm', output: text ? [{ id: 'i', type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }] : [], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 }, storedInput: input, storedAt: 9999999999, ...(prev ? { previousResponseId: prev } : {}) }
}

describe('expandPreviousResponseHistory', () => {
  it('两级链 oldest-first：input+output 重放', () => {
    const store: Record<string, StoredResponseDoc> = {
      A: mkDoc('A', 'q1', 'a1'),
      B: mkDoc('B', 'q2', 'a2', 'A'),
    }
    const msgs = expandPreviousResponseHistory('B', (id) => store[id] ?? null)
    expect(msgs.map((m) => m.content)).toEqual(['q1', 'a1', 'q2', 'a2'])
  })
  it('instructions 沿链重注入 system', () => {
    const d = mkDoc('A', 'q', 'a'); d.instructions = 'sys'
    const msgs = expandPreviousResponseHistory('A', (id) => (id === 'A' ? d : null))
    expect(msgs[0]).toEqual({ role: 'system', content: 'sys' })
  })
  it('链中缺失即止（不报错）', () => {
    const store: Record<string, StoredResponseDoc> = { B: mkDoc('B', 'q2', 'a2', 'MISSING') }
    const msgs = expandPreviousResponseHistory('B', (id) => store[id] ?? null)
    expect(msgs.map((m) => m.content)).toEqual(['q2', 'a2'])
  })
  it('环路防护：visited 短路', () => {
    const store: Record<string, StoredResponseDoc> = { A: mkDoc('A', 'qa', 'aa', 'B'), B: mkDoc('B', 'qb', 'ab', 'A') }
    const msgs = expandPreviousResponseHistory('A', (id) => store[id] ?? null)
    expect(msgs.length).toBeGreaterThan(0)
  })
})
