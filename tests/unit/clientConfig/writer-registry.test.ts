import { describe, it, expect } from 'vitest'
import { WriterRegistry } from '../../../src/main/contexts/clientConfig/application/writer-registry'
import { ClaudeWriter } from '../../../src/main/contexts/clientConfig/infrastructure/writers/claude-writer'
import { GeminiWriter } from '../../../src/main/contexts/clientConfig/infrastructure/writers/gemini-writer'

describe('WriterRegistry', () => {
  it('register/get/has/clientIds', () => {
    const r = new WriterRegistry()
    r.register(new ClaudeWriter('/x/settings.json'))
    r.register(new GeminiWriter('/y/.env', '/y/settings.json'))
    expect(r.has('claude')).toBe(true)
    expect(r.has('gemini_cli')).toBe(true)
    expect(r.has('codex')).toBe(false)
    expect(r.get('claude')!.writeMode).toBe('switch')
    expect(r.get('codex')).toBeUndefined()
    expect(r.clientIds().sort()).toEqual(['claude', 'gemini_cli'])
  })

  it('同 clientId 重复注册 → 后者覆盖', () => {
    const r = new WriterRegistry()
    const w1 = new ClaudeWriter('/a/settings.json')
    const w2 = new ClaudeWriter('/b/settings.json')
    r.register(w1)
    r.register(w2)
    expect(r.get('claude')!.configFiles()).toEqual(['/b/settings.json'])
  })
})
