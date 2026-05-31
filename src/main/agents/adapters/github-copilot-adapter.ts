// GitHub Copilot adapter — Standalone, credential-only.
// Credential format is hosts.json: {"github.com":{"oauth_token":"..."}}.
// Path is ~/.config/github-copilot/hosts.json (dotDir("config")/github-copilot
// in the Rust source — note this is ~/.config on ALL platforms, not appSupportDir).
// Mirrors Rust GithubCopilotAdapter.

import { join } from 'node:path'
import { BaseAgentClient } from '../domain/base-agent-client'
import type { AgentId } from '../domain/agent-id'
import type { AgentFamily } from '../domain/agent-family'
import { AgentCapabilities } from '../domain/capability'
import type { CredentialInjection } from '../domain/credential-injection'
import { dotDir } from '../infrastructure/shared/path-resolver'
import { FileCredentialInjection } from '../infrastructure/shared/credential-injection-base'

export class GithubCopilotAdapter extends BaseAgentClient {
  private readonly credential = new FileCredentialInjection(
    join(dotDir('config'), 'github-copilot', 'hosts.json'),
    'hosts_json',
  )

  id(): AgentId {
    return 'github_copilot'
  }
  family(): AgentFamily {
    return 'standalone'
  }
  displayName(): string {
    return 'GitHub Copilot'
  }
  capabilities(): AgentCapabilities {
    return AgentCapabilities.of('credential')
  }
  override asCredentialInjection(): CredentialInjection {
    return this.credential
  }
}
