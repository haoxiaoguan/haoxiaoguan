// BaseAgentClient — abstract base providing the Rust trait's default behavior:
// hasCapability() reads the capability bitmask, and every as*() accessor returns
// undefined unless the concrete adapter overrides it. Concrete adapters declare
// id/family/displayName/capabilities and override only the accessors for the
// capabilities they support — exactly mirroring the source's default-None impls.

import type { AgentClient } from './agent-client'
import type { AgentId } from './agent-id'
import type { AgentFamily } from './agent-family'
import type { AgentCapabilities, Capability } from './capability'
import type { CredentialInjection } from './credential-injection'
import type { SkillsSync } from './skills-sync'
import type { McpSync } from './mcp-sync'
import type { SessionLogReader } from './session-log-reader'

export abstract class BaseAgentClient implements AgentClient {
  abstract id(): AgentId
  abstract family(): AgentFamily
  abstract displayName(): string
  abstract capabilities(): AgentCapabilities

  hasCapability(cap: Capability): boolean {
    return this.capabilities().has(cap)
  }

  asCredentialInjection(): CredentialInjection | undefined {
    return undefined
  }
  asSkillsSync(): SkillsSync | undefined {
    return undefined
  }
  asMcpSync(): McpSync | undefined {
    return undefined
  }
  asSessionLogReader(): SessionLogReader | undefined {
    return undefined
  }
}
