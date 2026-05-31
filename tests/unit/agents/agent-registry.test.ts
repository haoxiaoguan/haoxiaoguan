import { describe, it, expect } from 'vitest'
import { AgentRegistry } from '../../../src/main/agents/domain/agent-registry'
import { BaseAgentClient } from '../../../src/main/agents/domain/base-agent-client'
import { AgentCapabilities, type Capability } from '../../../src/main/agents/domain/capability'
import type { AgentId } from '../../../src/main/agents/domain/agent-id'
import type { AgentFamily } from '../../../src/main/agents/domain/agent-family'

class MockAgent extends BaseAgentClient {
  constructor(
    private readonly _id: AgentId,
    private readonly _caps: AgentCapabilities,
  ) {
    super()
  }
  id(): AgentId {
    return this._id
  }
  family(): AgentFamily {
    return 'standalone'
  }
  displayName(): string {
    return 'Mock'
  }
  capabilities(): AgentCapabilities {
    return this._caps
  }
}

describe('AgentRegistry', () => {
  it('register() then get() finds the adapter, missing ids return undefined', () => {
    const reg = new AgentRegistry()
    reg.register(new MockAgent('claude', AgentCapabilities.of('skills')))
    expect(reg.get('claude')).toBeDefined()
    expect(reg.get('codex')).toBeUndefined()
  })

  it('count() reflects the number of registered adapters', () => {
    const reg = new AgentRegistry()
    expect(reg.count()).toBe(0)
    reg.register(new MockAgent('codex', AgentCapabilities.none()))
    expect(reg.count()).toBe(1)
  })

  it('listByCapability() filters by capability', () => {
    const reg = new AgentRegistry([
      new MockAgent('claude', AgentCapabilities.of('skills', 'mcp')),
      new MockAgent('cursor', AgentCapabilities.of('credential')),
    ])
    const skillsAgents = reg.listByCapability('skills')
    expect(skillsAgents.map((a) => a.id())).toEqual(['claude'])

    const credAgents = reg.listByCapability('credential')
    expect(credAgents.map((a) => a.id())).toEqual(['cursor'])
  })

  it('constructor keys by id — a duplicate id replaces the earlier adapter', () => {
    const reg = new AgentRegistry([
      new MockAgent('claude', AgentCapabilities.of('skills')),
      new MockAgent('claude', AgentCapabilities.of('mcp')),
    ])
    expect(reg.count()).toBe(1)
    expect(reg.get('claude')?.hasCapability('mcp')).toBe(true)
  })

  it('listAll() preserves registration (insertion) order', () => {
    const ids: AgentId[] = ['cursor', 'codex', 'claude']
    const reg = new AgentRegistry(ids.map((id) => new MockAgent(id, AgentCapabilities.none())))
    expect(reg.listAll().map((a) => a.id())).toEqual(ids)
  })

  it('hasCapability() reads the bitmask via BaseAgentClient', () => {
    const a = new MockAgent('zed', AgentCapabilities.of('credential'))
    const cap: Capability = 'credential'
    expect(a.hasCapability(cap)).toBe(true)
    expect(a.hasCapability('mcp')).toBe(false)
  })
})
