import type { PlatformId } from '../../contexts/account/domain/platform-id'
import { platformToAgentId } from '../../contexts/account/domain/platform-id'
import type { Credential } from '../../contexts/account/domain/credential'
import type {
  CredentialInjectionPort,
  CredentialInjectorRegistry,
} from '../../contexts/account/domain/ports'
import { type CredentialInjection, type DecryptedCredential } from './credential-injection'
import { makeInjectionAdapter } from './file-injection-adapters'
import { CodexCredentialInjectionPort } from './codex-injection'

// Adapts an agents-layer CredentialInjection adapter to the account context's
// CredentialInjectionPort. Converts the account Credential aggregate into the
// agents DecryptedCredential DTO (raw_metadata → JSON string, matching the Rust
// DecryptedCredential.metadata: Option<String>).
class InjectionPortAdapter implements CredentialInjectionPort {
  constructor(private readonly capability: CredentialInjection) {}

  async inject(_platform: PlatformId, credential: Credential): Promise<void> {
    const decrypted: DecryptedCredential = {
      token: credential.token,
      refreshToken: credential.refreshToken,
      metadata:
        credential.rawMetadata === undefined ? undefined : JSON.stringify(credential.rawMetadata),
    }
    await this.capability.inject(decrypted)
  }
}

function adapterPort(capability: CredentialInjection | undefined): CredentialInjectionPort | undefined {
  return capability === undefined ? undefined : new InjectionPortAdapter(capability)
}

/**
 * CredentialInjectorRegistry backed by the agents file-injection adapters.
 * Resolves a per-platform injector keyed by the canonical agent_id string.
 * Caches adapters since they are stateless.
 */
export class AgentCredentialInjectorRegistry implements CredentialInjectorRegistry {
  private readonly cache = new Map<string, CredentialInjectionPort | undefined>()

  injector(platform: PlatformId): CredentialInjectionPort | undefined {
    const agentId = platformToAgentId(platform)
    if (this.cache.has(agentId)) return this.cache.get(agentId)
    // Codex 不走通用 {"token": ...} 注入：auth.json 必须按官方结构整写（OAuth 全量
    // tokens / API Key auth_mode），否则 Codex 直接掉登录。
    const port =
      agentId === 'codex'
        ? new CodexCredentialInjectionPort()
        : adapterPort(makeInjectionAdapter(agentId))
    this.cache.set(agentId, port)
    return port
  }
}
