// Qoder adapter — Standalone. Credential ({token} json) + session_log
// (task-*.session.execution-session.json). Mirrors Rust QoderAdapter.

import { join } from 'node:path'
import { BaseAgentClient } from '../domain/base-agent-client'
import type { AgentId } from '../domain/agent-id'
import type { AgentFamily } from '../domain/agent-family'
import { AgentCapabilities } from '../domain/capability'
import type { CredentialInjection } from '../domain/credential-injection'
import type { SessionLogReader } from '../domain/session-log-reader'
import { appSupportDir } from '../infrastructure/shared/path-resolver'
import { FileCredentialInjection } from '../infrastructure/shared/credential-injection-base'
import { QoderSessionLogReader } from '../infrastructure/shared/session-log-readers'

export class QoderAdapter extends BaseAgentClient {
  private readonly credential = new FileCredentialInjection(
    join(appSupportDir('Qoder'), 'credentials.json'),
    'token_json',
  )
  private readonly reader = new QoderSessionLogReader()

  id(): AgentId {
    return 'qoder'
  }
  family(): AgentFamily {
    return 'standalone'
  }
  displayName(): string {
    return 'Qoder'
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
