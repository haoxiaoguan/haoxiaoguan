import { describe, it, expect } from 'vitest'
import { PlatformRegistry, NoUpstreamError } from '../../../src/main/contexts/apiProxy/infrastructure/platform-registry'
import type { PlatformUpstreamAdapter, ModelInfo } from '../../../src/main/contexts/apiProxy/domain/platform-adapter'
import type { CanonicalResponse, CanonicalStreamEvent } from '../../../src/main/contexts/apiProxy/domain/canonical'

function fake(platform: string, models: string[]): PlatformUpstreamAdapter {
  return {
    platform,
    supportsModel: (m) => models.includes(m),
    listModels: (): ModelInfo[] => models.map((id) => ({ id })),
    async chat(): Promise<CanonicalResponse> {
      return { model: models[0] ?? 'x', content: [], stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } }
    },
    async *chatStream(): AsyncIterable<CanonicalStreamEvent> {
      yield { type: 'message_stop', stopReason: 'end_turn' }
    },
  }
}

describe('PlatformRegistry', () => {
  it('register/get/knownPlatforms', () => {
    const r = new PlatformRegistry()
    r.register(fake('echo', ['echo-1']))
    expect(r.get('echo')?.platform).toBe('echo')
    expect(r.get('nope')).toBeUndefined()
    expect([...r.knownPlatforms()]).toEqual(['echo'])
  })

  it('findPlatformsForModel returns all matching in registration order', () => {
    const r = new PlatformRegistry()
    r.register(fake('a', ['shared']))
    r.register(fake('b', ['shared', 'b-only']))
    expect(r.findPlatformsForModel('shared').map((a) => a.platform)).toEqual(['a', 'b'])
    expect(r.findPlatformsForModel('b-only').map((a) => a.platform)).toEqual(['b'])
    expect(r.findPlatformsForModel('none')).toEqual([])
  })

  it('selectAdapter: platform-locked path takes the named platform', () => {
    const r = new PlatformRegistry()
    r.register(fake('echo', ['echo-1']))
    const a = r.selectAdapter({ platform: 'echo', format: 'openai', action: 'chat', model: 'echo-1', stream: false })
    expect(a.platform).toBe('echo')
  })

  it('selectAdapter: locked platform that does not support model → NoUpstreamError', () => {
    const r = new PlatformRegistry()
    r.register(fake('echo', ['echo-1']))
    expect(() => r.selectAdapter({ platform: 'echo', format: 'openai', action: 'chat', model: 'other', stream: false })).toThrow(NoUpstreamError)
  })

  it('selectAdapter: bare path is model-aware (first match)', () => {
    const r = new PlatformRegistry()
    r.register(fake('a', ['shared']))
    r.register(fake('b', ['shared']))
    const a = r.selectAdapter({ format: 'openai', action: 'chat', model: 'shared', stream: false })
    expect(a.platform).toBe('a')
  })

  it('selectAdapter: bare path with no matching model → NoUpstreamError', () => {
    const r = new PlatformRegistry()
    r.register(fake('a', ['x']))
    expect(() => r.selectAdapter({ format: 'openai', action: 'chat', model: 'y', stream: false })).toThrow(NoUpstreamError)
  })

  it('listAllModels dedups by id; platform filter scopes to one', () => {
    const r = new PlatformRegistry()
    r.register(fake('a', ['m1', 'shared']))
    r.register(fake('b', ['shared', 'm2']))
    expect(r.listAllModels().map((m) => m.id)).toEqual(['m1', 'shared', 'm2'])
    expect(r.listAllModels('b').map((m) => m.id)).toEqual(['shared', 'm2'])
    expect(r.listAllModels('nope')).toEqual([])
  })
})
