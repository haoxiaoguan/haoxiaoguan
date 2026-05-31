// Claude Code adapter — CliAgent. skills (~/.claude/skills) + mcp (~/.claude.json,
// key mcpServers) + session_log (~/.claude/projects/**/*.jsonl). No credential.
// Mirrors Rust ClaudeAdapter.

import { join } from 'node:path'
import { BaseAgentClient } from '../domain/base-agent-client'
import type { AgentId } from '../domain/agent-id'
import type { AgentFamily } from '../domain/agent-family'
import { AgentCapabilities } from '../domain/capability'
import type { SkillsSync } from '../domain/skills-sync'
import type { McpSync } from '../domain/mcp-sync'
import type { SessionLogReader } from '../domain/session-log-reader'
import { dotDir, homeDir } from '../infrastructure/shared/path-resolver'
import { DirSkillsSync } from '../infrastructure/shared/skills-sync-base'
import { JsonMcpSync } from '../infrastructure/shared/mcp-sync-base'
import { ClaudeSessionLogReader } from '../infrastructure/shared/session-log-readers'

export class ClaudeAdapter extends BaseAgentClient {
  private readonly skills = new DirSkillsSync(join(dotDir('claude'), 'skills'))
  private readonly mcp = new JsonMcpSync(join(homeDir(), '.claude.json'), 'mcpServers')
  private readonly reader = new ClaudeSessionLogReader()

  id(): AgentId {
    return 'claude'
  }
  family(): AgentFamily {
    return 'cli_agent'
  }
  displayName(): string {
    return 'Claude Code'
  }
  capabilities(): AgentCapabilities {
    return AgentCapabilities.of('skills', 'mcp', 'session_log')
  }
  override asSkillsSync(): SkillsSync {
    return this.skills
  }
  override asMcpSync(): McpSync {
    return this.mcp
  }
  override asSessionLogReader(): SessionLogReader {
    return this.reader
  }
}
