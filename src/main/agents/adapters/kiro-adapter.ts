// Kiro adapter — VSCode family. Credential (storage.json merge) + session_log
// (single tokens_generated.jsonl). Mirrors Rust KiroAdapter.

import { join } from 'node:path'
import { BaseAgentClient } from '../domain/base-agent-client'
import type { AgentId } from '../domain/agent-id'
import type { AgentFamily } from '../domain/agent-family'
import { AgentCapabilities } from '../domain/capability'
import type { CredentialInjection } from '../domain/credential-injection'
import type { SessionLogReader } from '../domain/session-log-reader'
import { appSupportDir } from '../infrastructure/shared/path-resolver'
import { FileCredentialInjection } from '../infrastructure/shared/credential-injection-base'
import { KiroSessionLogReader } from '../infrastructure/shared/session-log-readers'

export class KiroAdapter extends BaseAgentClient {
  private readonly credential = new FileCredentialInjection(
    join(appSupportDir('Kiro'), 'User', 'globalStorage', 'storage.json'),
    'storage_json',
  )
  private readonly reader = new KiroSessionLogReader()

  id(): AgentId {
    return 'kiro'
  }
  family(): AgentFamily {
    return 'v_s_code'
  }
  displayName(): string {
    return 'Kiro'
  }
  capabilities(): AgentCapabilities {
    return AgentCapabilities.of('credential', 'session_log')
  }
  override asCredentialInjection(): CredentialInjection {
    return this.credential
  }
  override asSessionLogReader(): SessionLogReader {
    return this.reader
  }
}
