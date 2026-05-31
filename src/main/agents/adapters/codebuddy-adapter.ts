// CodeBuddy adapter — VSCode family, credential-only (storage.json merge).
// Mirrors Rust CodebuddyAdapter (app dir "CodeBuddy").

import { join } from 'node:path'
import { BaseAgentClient } from '../domain/base-agent-client'
import type { AgentId } from '../domain/agent-id'
import type { AgentFamily } from '../domain/agent-family'
import { AgentCapabilities } from '../domain/capability'
import type { CredentialInjection } from '../domain/credential-injection'
import { appSupportDir } from '../infrastructure/shared/path-resolver'
import { FileCredentialInjection } from '../infrastructure/shared/credential-injection-base'

export class CodebuddyAdapter extends BaseAgentClient {
  private readonly credential = new FileCredentialInjection(
    join(appSupportDir('CodeBuddy'), 'User', 'globalStorage', 'storage.json'),
    'storage_json',
  )

  id(): AgentId {
    return 'codebuddy'
  }
  family(): AgentFamily {
    return 'v_s_code'
  }
  displayName(): string {
    return 'CodeBuddy'
  }
  capabilities(): AgentCapabilities {
    return AgentCapabilities.of('credential')
  }
  override asCredentialInjection(): CredentialInjection {
    return this.credential
  }
}
