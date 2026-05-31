// Zed adapter — Standalone, credential-only.
// Credential format is {"token":"..."} at ~/.zed/credentials.json.
// Mirrors Rust ZedAdapter.

import { join } from 'node:path'
import { BaseAgentClient } from '../domain/base-agent-client'
import type { AgentId } from '../domain/agent-id'
import type { AgentFamily } from '../domain/agent-family'
import { AgentCapabilities } from '../domain/capability'
import type { CredentialInjection } from '../domain/credential-injection'
import { dotDir } from '../infrastructure/shared/path-resolver'
import { FileCredentialInjection } from '../infrastructure/shared/credential-injection-base'

export class ZedAdapter extends BaseAgentClient {
  private readonly credential = new FileCredentialInjection(
    join(dotDir('zed'), 'credentials.json'),
    'token_json',
  )

  id(): AgentId {
    return 'zed'
  }
  family(): AgentFamily {
    return 'standalone'
  }
  displayName(): string {
    return 'Zed'
  }
  capabilities(): AgentCapabilities {
    return AgentCapabilities.of('credential')
  }
  override asCredentialInjection(): CredentialInjection {
    return this.credential
  }
}
