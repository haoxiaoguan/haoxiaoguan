// AgentRegistryService — thin facade over AgentRegistry that projects each
// AgentClient into the serializable AgentInfo DTO. Mirrors Rust
// agents::application::agent_registry_service::AgentRegistryService.
//
// AgentInfo is emitted in the frontend's camelCase contract
// ({ id, displayName, family, capabilities }) per map_frontend_ipc.md — the
// authoritative byte-for-byte IPC return shape consumed by renderer agentService.

import type { AgentRegistry } from '../domain/agent-registry'
import type { AgentClient } from '../domain/agent-client'
import type { AgentId } from '../domain/agent-id'
import type { AgentFamily } from '../domain/agent-family'
import type { Capability } from '../domain/capability'

export interface AgentInfo {
  id: AgentId
  displayName: string
  family: AgentFamily
  capabilities: Capability[]
}

export class AgentRegistryService {
  constructor(private readonly registry: AgentRegistry) {}

  /** All registered agents, projected to AgentInfo (registration order). */
  listAll(): AgentInfo[] {
    return this.registry.listAll().map(toInfo)
  }

  /** Agents that support `cap`, projected to AgentInfo. */
  listByCapability(cap: Capability): AgentInfo[] {
    return this.registry.listByCapability(cap).map(toInfo)
  }

  /** AgentInfo for `id`, or undefined if not registered. */
  get(id: AgentId): AgentInfo | undefined {
    const client = this.registry.get(id)
    return client ? toInfo(client) : undefined
  }

  /** Capabilities for `id` (canonical order), or undefined if not registered. */
  getCapabilities(id: AgentId): Capability[] | undefined {
    const client = this.registry.get(id)
    return client ? client.capabilities().list() : undefined
  }
}

function toInfo(agent: AgentClient): AgentInfo {
  return {
    id: agent.id(),
    displayName: agent.displayName(),
    family: agent.family(),
    capabilities: agent.capabilities().list(),
  }
}
