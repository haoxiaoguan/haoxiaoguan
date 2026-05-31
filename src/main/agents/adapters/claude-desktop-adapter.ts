// Claude Desktop adapter — CliAgent. skills + mcp, no credential / session_log.
// skills: appSupportDir("Claude")/skills; mcp: appSupportDir("Claude")/
// claude_desktop_config.json (key mcpServers). Mirrors Rust ClaudeDesktopAdapter.

import { join } from 'node:path'
import { BaseAgentClient } from '../domain/base-agent-client'
import type { AgentId } from '../domain/agent-id'
import type { AgentFamily } from '../domain/agent-family'
import { AgentCapabilities } from '../domain/capability'
import type { SkillsSync } from '../domain/skills-sync'
import type { McpSync } from '../domain/mcp-sync'
import { appSupportDir } from '../infrastructure/shared/path-resolver'
import { DirSkillsSync } from '../infrastructure/shared/skills-sync-base'
import { JsonMcpSync } from '../infrastructure/shared/mcp-sync-base'

export class ClaudeDesktopAdapter extends BaseAgentClient {
  private readonly skills = new DirSkillsSync(join(appSupportDir('Claude'), 'skills'))
  private readonly mcp = new JsonMcpSync(
    join(appSupportDir('Claude'), 'claude_desktop_config.json'),
    'mcpServers',
  )

  id(): AgentId {
    return 'claude_desktop'
  }
  family(): AgentFamily {
    return 'cli_agent'
  }
  displayName(): string {
    return 'Claude Desktop'
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
