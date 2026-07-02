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
import { ZedCredentialInjectionPort } from './zed-injection'
import { GeminiCredentialInjectionPort } from './gemini-injection'
import { KiroCredentialInjectionPort } from './kiro-injection'
import { CodebuddyCredentialInjectionPort } from './codebuddy-injection'
import { QoderCredentialInjectionPort } from './qoder-injection'
import { GitHubCopilotCredentialInjectionPort } from './github-copilot-injection'
import { WindsurfCredentialInjectionPort } from './windsurf-injection'
import { TraeCredentialInjectionPort } from './trae-injection'
import { AntigravityCredentialInjectionPort } from './antigravity-injection'

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
    // 专用注入端口：这些平台客户端真实登录态不在通用 storage.json/{"token"} 里，
    // 通用注入写了也切不动（详见各端口文件头注释）。
    //   codex          → auth.json 官方结构 + config.toml + macOS Keychain
    //   zed            → macOS Keychain internet-password（server=https://zed.dev）
    //   gemini_cli     → ~/.gemini 多文件 + macOS Keychain（gemini-cli-oauth）
    //   kiro           → ~/.aws/sso/cache/kiro-auth-token.json + profile.json
    //   codebuddy(_cn) → state.vscdb 加密 SecretStorage（planning-genie session）
    //   qoder          → state.vscdb 加密 SecretStorage（aicoding.auth.*）
    //   github_copilot → state.vscdb 加密 github.auth sessions + 明文偏好键
    //   windsurf       → state.vscdb windsurfAuthStatus + 加密 sessions/apiServerUrl
    //                    + codeium.windsurf(保留 installationId) + onboarding
    //   trae           → storage.json iCubeAuthInfo://*（ByteCrypto v1 加密）+ 设备密钥对
    //   antigravity(_ide) → state.vscdb antigravityUnifiedStateSync.oauthToken/userStatus
    //                    （明文 base64 protobuf；antigravity→"Antigravity"、
    //                     antigravity_ide→"Antigravity IDE"）
    // 其余平台走通用文件注入（cursor 走专用 vscdb）。
    const port = this.specializedPort(agentId) ?? adapterPort(makeInjectionAdapter(agentId))
    this.cache.set(agentId, port)
    return port
  }

  private specializedPort(agentId: string): CredentialInjectionPort | undefined {
    switch (agentId) {
      case 'codex':
        return new CodexCredentialInjectionPort()
      case 'zed':
        return new ZedCredentialInjectionPort()
      case 'gemini_cli':
        return new GeminiCredentialInjectionPort()
      case 'kiro':
        return new KiroCredentialInjectionPort()
      case 'codebuddy':
        return new CodebuddyCredentialInjectionPort('codebuddy')
      case 'codebuddy_cn':
        return new CodebuddyCredentialInjectionPort('codebuddy_cn')
      case 'qoder':
        return new QoderCredentialInjectionPort()
      case 'github_copilot':
        return new GitHubCopilotCredentialInjectionPort()
      case 'windsurf':
        return new WindsurfCredentialInjectionPort()
      case 'trae':
        return new TraeCredentialInjectionPort()
      case 'antigravity':
        return new AntigravityCredentialInjectionPort('antigravity')
      case 'antigravity_ide':
        return new AntigravityCredentialInjectionPort('antigravity_ide')
      default:
        return undefined
    }
  }
}
