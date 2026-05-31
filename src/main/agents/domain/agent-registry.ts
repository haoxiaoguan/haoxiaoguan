// AgentRegistry — holds all registered agent adapters and provides lookup by id
// or capability. Mirrors Rust agents::infrastructure::AgentRegistry +
// AgentRegistryTrait. Backed by a Map keyed by AgentId.
//
// NOTE: the Rust source stores adapters in a HashMap with non-deterministic
// iteration order; this port preserves INSERTION order (Map semantics), which
// is deterministic. listAll()/listByCapability() therefore return agents in the
// order they were registered. The frontend must not rely on a specific order.

import type { AgentClient } from './agent-client'
import type { AgentId } from './agent-id'
import type { Capability } from './capability'

export class AgentRegistry {
  private readonly clients: Map<AgentId, AgentClient>

  constructor(clients: AgentClient[] = []) {
    this.clients = new Map(clients.map((c) => [c.id(), c]))
  }

  /** Register (or replace) an adapter, keyed by its AgentId. */
  register(adapter: AgentClient): void {
    this.clients.set(adapter.id(), adapter)
  }

  /** Number of registered adapters. */
  count(): number {
    return this.clients.size
  }

  get(id: AgentId): AgentClient | undefined {
    return this.clients.get(id)
  }

  listAll(): AgentClient[] {
    return Array.from(this.clients.values())
  }

  listByCapability(cap: Capability): AgentClient[] {
    return this.listAll().filter((c) => c.hasCapability(cap))
  }
}
