// Gemini CLI adapter — Standalone, all four capabilities.
// credential: ~/.gemini/auth.json ({token}); skills: ~/.gemini/skills;
// mcp: ~/.gemini/settings.json (key mcpServers); session_log: session-*.json
// (events[] array, output = output + thoughts). Mirrors Rust GeminiCliAdapter.

import { join } from 'node:path'
import { BaseAgentClient } from '../domain/base-agent-client'
import type { AgentId } from '../domain/agent-id'
import type { AgentFamily } from '../domain/agent-family'
import { AgentCapabilities } from '../domain/capability'
import type { CredentialInjection } from '../domain/credential-injection'
import type { SkillsSync } from '../domain/skills-sync'
import type { McpSync } from '../domain/mcp-sync'
import type { SessionLogReader } from '../domain/session-log-reader'
import { dotDir } from '../infrastructure/shared/path-resolver'
import { FileCredentialInjection } from '../infrastructure/shared/credential-injection-base'
import { DirSkillsSync } from '../infrastructure/shared/skills-sync-base'
import { JsonMcpSync } from '../infrastructure/shared/mcp-sync-base'
import { GeminiCliSessionLogReader } from '../infrastructure/shared/session-log-readers'

export class GeminiCliAdapter extends BaseAgentClient {
  private readonly credential = new FileCredentialInjection(
    join(dotDir('gemini'), 'auth.json'),
    'token_json',
  )
  private readonly skills = new DirSkillsSync(join(dotDir('gemini'), 'skills'))
  private readonly mcp = new JsonMcpSync(join(dotDir('gemini'), 'settings.json'), 'mcpServers')
  private readonly reader = new GeminiCliSessionLogReader()

  id(): AgentId {
    return 'gemini_cli'
  }
  family(): AgentFamily {
    return 'standalone'
  }
  displayName(): string {
    return 'Gemini CLI'
  }
  capabilities(): AgentCapabilities {
    return AgentCapabilities.of('credential', 'skills', 'mcp', 'session_log')
  }
  override asCredentialInjection(): CredentialInjection {
    return this.credential
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
