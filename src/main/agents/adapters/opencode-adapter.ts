// OpenCode adapter — CliAgent. skills + mcp, no credential / session_log.
// skills: ~/.opencode/skills; mcp: ~/.config/opencode/opencode.json (key "mcp").
// Mirrors Rust OpenCodeAdapter (note skills uses dot_dir but mcp uses ~/.config).

import { join } from 'node:path'
import { BaseAgentClient } from '../domain/base-agent-client'
import type { AgentId } from '../domain/agent-id'
import type { AgentFamily } from '../domain/agent-family'
import { AgentCapabilities } from '../domain/capability'
import type { SkillsSync } from '../domain/skills-sync'
import type { McpSync } from '../domain/mcp-sync'
import { dotDir, homeDir } from '../infrastructure/shared/path-resolver'
import { DirSkillsSync } from '../infrastructure/shared/skills-sync-base'
import { JsonMcpSync } from '../infrastructure/shared/mcp-sync-base'

export class OpenCodeAdapter extends BaseAgentClient {
  private readonly skills = new DirSkillsSync(join(dotDir('opencode'), 'skills'))
  private readonly mcp = new JsonMcpSync(
    join(homeDir(), '.config', 'opencode', 'opencode.json'),
    'mcp',
  )

  id(): AgentId {
    return 'opencode'
  }
  family(): AgentFamily {
    return 'cli_agent'
  }
  displayName(): string {
    return 'OpenCode'
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
