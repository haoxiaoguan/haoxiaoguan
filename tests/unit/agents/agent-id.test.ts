import { describe, it, expect } from 'vitest'
import { parseAgentId, isAgentId, ALL_AGENT_IDS } from '../../../src/main/agents/domain/agent-id'

describe('AgentId', () => {
  it('lists exactly 17 agents', () => {
    expect(ALL_AGENT_IDS.length).toBe(17)
  })

  it('round-trips every id through parseAgentId', () => {
    for (const id of ALL_AGENT_IDS) {
      expect(parseAgentId(id)).toBe(id)
    }
  })

  it('parseAgentId throws on unknown id', () => {
    expect(() => parseAgentId('not_an_agent')).toThrow("unknown agent id: 'not_an_agent'")
  })

  it('isAgentId is a correct type guard', () => {
    expect(isAgentId('claude')).toBe(true)
    expect(isAgentId('github_copilot')).toBe(true)
    expect(isAgentId('nope')).toBe(false)
  })
})
