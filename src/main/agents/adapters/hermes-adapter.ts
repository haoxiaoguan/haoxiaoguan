// Hermes adapter — CliAgent. skills + mcp, no credential / session_log.
// skills: ~/.hermes/skills; mcp: ~/.hermes/mcp_servers.json (key "mcpServers",
// JSON sidecar). Mirrors Rust HermesAdapter.

import { join } from 'node:path'
import { BaseAgentClient } from '../domain/base-agent-client'
import type { AgentId } from '../domain/agent-id'
import type { AgentFamily } from '../domain/agent-family'
import { AgentCapabilities } from '../domain/capability'
import type { SkillsSync } from '../domain/skills-sync'
import type { McpSync } from '../domain/mcp-sync'
import { dotDir } from '../infrastructure/shared/path-resolver'
import { DirSkillsSync } from '../infrastructure/shared/skills-sync-base'
import { JsonMcpSync } from '../infrastructure/shared/mcp-sync-base'

export class HermesAdapter extends BaseAgentClient {
  private readonly skills = new DirSkillsSync(join(dotDir('hermes'), 'skills'))
  private readonly mcp = new JsonMcpSync(join(dotDir('hermes'), 'mcp_servers.json'), 'mcpServers')

  id(): AgentId {
    return 'hermes'
  }
  family(): AgentFamily {
    return 'cli_agent'
  }
  displayName(): string {
    return 'Hermes'
  }
  capabilities(): AgentCapabilities {
    return AgentCapabilities.of('skills', 'mcp')
  }
  override asSkillsSync(): SkillsSync {
    return this.skills
  }
  override asMcpSync(): McpSync {
    return this.mcp
  }
}
