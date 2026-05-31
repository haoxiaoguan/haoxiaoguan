// AgentClient interface — the base interface every agent adapter implements.
// Mirrors Rust agents::domain::agent_client::AgentClient (trait object).
//
// Capability-specific interfaces (CredentialInjection, SkillsSync, McpSync,
// SessionLogReader) are returned via optional accessor methods so callers can
// check support without casting. Adapters override only the accessors for the
// capabilities they declare; the rest return undefined (see BaseAgentClient).

import type { AgentId } from './agent-id'
import type { AgentFamily } from './agent-family'
import type { AgentCapabilities, Capability } from './capability'
import type { CredentialInjection } from './credential-injection'
import type { SkillsSync } from './skills-sync'
import type { McpSync } from './mcp-sync'
import type { SessionLogReader } from './session-log-reader'

export interface AgentClient {
  id(): AgentId
  family(): AgentFamily
  displayName(): string
  capabilities(): AgentCapabilities
  hasCapability(cap: Capability): boolean

  // Capability accessors — return undefined if the agent does not support it.
  asCredentialInjection(): CredentialInjection | undefined
  asSkillsSync(): SkillsSync | undefined
  asMcpSync(): McpSync | undefined
  asSessionLogReader(): SessionLogReader | undefined
}
