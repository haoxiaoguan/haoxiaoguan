// Gemini app adapter — CliAgent. skills + mcp, no credential / session_log.
// skills: appSupportDir("Gemini")/skills; mcp: dotDir("gemini")/settings.json
// (key mcpServers) — INTENTIONALLY the SAME file as the Gemini CLI adapter, so
// both write the same MCP config. Mirrors Rust GeminiAdapter (documented risk).

import { join } from 'node:path'
import { BaseAgentClient } from '../domain/base-agent-client'
import type { AgentId } from '../domain/agent-id'
import type { AgentFamily } from '../domain/agent-family'
import { AgentCapabilities } from '../domain/capability'
import type { SkillsSync } from '../domain/skills-sync'
import type { McpSync } from '../domain/mcp-sync'
import { appSupportDir, dotDir } from '../infrastructure/shared/path-resolver'
import { DirSkillsSync } from '../infrastructure/shared/skills-sync-base'
import { JsonMcpSync } from '../infrastructure/shared/mcp-sync-base'

export class GeminiAdapter extends BaseAgentClient {
  private readonly skills = new DirSkillsSync(join(appSupportDir('Gemini'), 'skills'))
  private readonly mcp = new JsonMcpSync(join(dotDir('gemini'), 'settings.json'), 'mcpServers')

  id(): AgentId {
    return 'gemini'
  }
  family(): AgentFamily {
    return 'cli_agent'
  }
  displayName(): string {
    return 'Gemini'
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
