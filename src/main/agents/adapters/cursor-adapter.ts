// Cursor adapter — VSCode family, credential-only (storage.json merge).
// Mirrors Rust CursorAdapter.

import { join } from 'node:path'
import { BaseAgentClient } from '../domain/base-agent-client'
import type { AgentId } from '../domain/agent-id'
import type { AgentFamily } from '../domain/agent-family'
import { AgentCapabilities } from '../domain/capability'
import type { CredentialInjection } from '../domain/credential-injection'
import { appSupportDir } from '../infrastructure/shared/path-resolver'
import { FileCredentialInjection } from '../infrastructure/shared/credential-injection-base'

export class CursorAdapter extends BaseAgentClient {
  private readonly credential = new FileCredentialInjection(
    join(appSupportDir('Cursor'), 'User', 'globalStorage', 'storage.json'),
    'storage_json',
  )

  id(): AgentId {
    return 'cursor'
  }
  family(): AgentFamily {
    return 'v_s_code'
  }
  displayName(): string {
    return 'Cursor'
  }
  capabilities(): AgentCapabilities {
    return AgentCapabilities.of('credential')
  }
  override asCredentialInjection(): CredentialInjection {
    return this.credential
  }
}
