import { describe, it, expect } from 'vitest'
import {
  CLIENT_NATIVE_PROTOCOL,
  resolveRelayDecision,
  resolveRelayDecisionForClient,
} from '../../../src/main/contexts/clientConfig/domain/protocol-routing'
import { CLIENT_IDS } from '../../../src/main/contexts/clientConfig/domain/client-profile'

describe('CLIENT_NATIVE_PROTOCOL', () => {
  it('每个 ClientId 都有值', () => {
    for (const id of CLIENT_IDS) {
      expect(CLIENT_NATIVE_PROTOCOL[id]).toBeTruthy()
    }
  })

  it('claude → anthropic', () => {
    expect(CLIENT_NATIVE_PROTOCOL.claude).toBe('anthropic')
  })

  it('codex → openai-responses', () => {
    expect(CLIENT_NATIVE_PROTOCOL.codex).toBe('openai-responses')
  })

  it('gemini_cli → gemini', () => {
    expect(CLIENT_NATIVE_PROTOCOL.gemini_cli).toBe('gemini')
  })

  it('opencode/openclaw/hermes → flexible', () => {
    expect(CLIENT_NATIVE_PROTOCOL.opencode).toBe('flexible')
    expect(CLIENT_NATIVE_PROTOCOL.openclaw).toBe('flexible')
    expect(CLIENT_NATIVE_PROTOCOL.hermes).toBe('flexible')
  })
})

describe('resolveRelayDecision', () => {
  describe('flexible 客户端 → 永远 direct', () => {
    it('opencode + anthropic → direct', () => {
      expect(resolveRelayDecision('flexible', 'anthropic')).toBe('direct')
    })
    it('flexible + openai-chat → direct', () => {
      expect(resolveRelayDecision('flexible', 'openai-chat')).toBe('direct')
    })
    it('flexible + gemini → direct', () => {
      expect(resolveRelayDecision('flexible', 'gemini')).toBe('direct')
    })
    it('flexible + openai-responses → direct', () => {
      expect(resolveRelayDecision('flexible', 'openai-responses')).toBe('direct')
    })
  })

  describe('协议相同 → direct', () => {
    it('anthropic ↔ anthropic → direct', () => {
      expect(resolveRelayDecision('anthropic', 'anthropic')).toBe('direct')
    })
    it('openai-chat ↔ openai-chat → direct', () => {
      expect(resolveRelayDecision('openai-chat', 'openai-chat')).toBe('direct')
    })
    it('openai-responses ↔ openai-responses → direct', () => {
      expect(resolveRelayDecision('openai-responses', 'openai-responses')).toBe('direct')
    })
    it('gemini ↔ gemini → direct', () => {
      expect(resolveRelayDecision('gemini', 'gemini')).toBe('direct')
    })
  })

  describe('协议不匹配 → relay', () => {
    it('Claude(anthropic) 接 openai-chat 上游 → relay', () => {
      expect(resolveRelayDecision('anthropic', 'openai-chat')).toBe('relay')
    })
    it('Codex(openai-responses) 接 openai-chat 上游 → relay(Codex++ 核心场景)', () => {
      expect(resolveRelayDecision('openai-responses', 'openai-chat')).toBe('relay')
    })
    it('Gemini CLI(gemini) 接 openai-chat → relay', () => {
      expect(resolveRelayDecision('gemini', 'openai-chat')).toBe('relay')
    })
    it('anthropic 接 openai-responses → relay', () => {
      expect(resolveRelayDecision('anthropic', 'openai-responses')).toBe('relay')
    })
    it('anthropic 接 gemini → relay', () => {
      expect(resolveRelayDecision('anthropic', 'gemini')).toBe('relay')
    })
    it('gemini 接 anthropic → relay', () => {
      expect(resolveRelayDecision('gemini', 'anthropic')).toBe('relay')
    })
  })
})

describe('resolveRelayDecisionForClient', () => {
  it('claude + openai-chat → relay', () => {
    expect(resolveRelayDecisionForClient('claude', 'openai-chat')).toBe('relay')
  })
  it('codex + openai-responses → direct', () => {
    expect(resolveRelayDecisionForClient('codex', 'openai-responses')).toBe('direct')
  })
  it('opencode + anthropic → direct', () => {
    expect(resolveRelayDecisionForClient('opencode', 'anthropic')).toBe('direct')
  })
  it('opencode + openai-chat → direct', () => {
    expect(resolveRelayDecisionForClient('opencode', 'openai-chat')).toBe('direct')
  })
  it('opencode + gemini → direct', () => {
    expect(resolveRelayDecisionForClient('opencode', 'gemini')).toBe('direct')
  })
  it('claude + anthropic → direct', () => {
    expect(resolveRelayDecisionForClient('claude', 'anthropic')).toBe('direct')
  })
  it('codex + openai-chat → relay', () => {
    expect(resolveRelayDecisionForClient('codex', 'openai-chat')).toBe('relay')
  })
  it('gemini_cli + gemini → direct', () => {
    expect(resolveRelayDecisionForClient('gemini_cli', 'gemini')).toBe('direct')
  })
  it('gemini_cli + anthropic → relay', () => {
    expect(resolveRelayDecisionForClient('gemini_cli', 'anthropic')).toBe('relay')
  })
})
