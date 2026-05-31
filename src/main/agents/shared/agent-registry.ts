/**
 * In-memory agent registry — holds all AgentClient instances and supports
 * filtering by capability. This is the TS equivalent of Rust AgentRegistryTrait.
 */
import type { AgentClient, AgentRegistry, Capability } from './session-log-reader'

export class InMemoryAgentRegistry implements AgentRegistry {
  private readonly agents: AgentClient[]

  constructor(agents: AgentClient[]) {
    this.agents = agents
  }

  listByCapability(cap: Capability): AgentClient[] {
    return this.agents.filter((a) => a.capabilities().includes(cap))
  }
}
