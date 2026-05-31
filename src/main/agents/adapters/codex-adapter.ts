// Codex adapter — Standalone, all four capabilities.
// credential: ~/.codex/auth.json ({token}); skills: ~/.codex/skills;
// mcp: ~/.codex/config.toml under [mcp_servers.*] (TOML); session_log: jsonl
// (cumulative-delta tokens). Mirrors Rust CodexAdapter.

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
import { TomlMcpSync } from '../infrastructure/shared/mcp-sync-base'
import { CodexSessionLogReader } from '../infrastructure/shared/session-log-readers'

export class CodexAdapter extends BaseAgentClient {
  private readonly credential = new FileCredentialInjection(
    join(dotDir('codex'), 'auth.json'),
    'token_json',
  )
  private readonly skills = new DirSkillsSync(join(dotDir('codex'), 'skills'))
  private readonly mcp = new TomlMcpSync(join(dotDir('codex'), 'config.toml'), 'mcp_servers')
  private readonly reader = new CodexSessionLogReader()

  id(): AgentId {
    return 'codex'
  }
  family(): AgentFamily {
    return 'standalone'
  }
  displayName(): string {
    return 'Codex'
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
