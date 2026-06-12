import type { PlatformId } from '../../contexts/account/domain/platform-id'
import type { Credential } from '../../contexts/account/domain/credential'
import type { CredentialInjectionPort } from '../../contexts/account/domain/ports'
import { atomicWrite } from '../../platform/fs/atomic-write'
import {
  buildCodexAuthFileValue,
  codexAuthJsonPath,
  codexHomeDir,
  isCodexApiKeyCredential,
} from './codex-auth-file'
import { createCodexKeychainSync, type CodexKeychainSync } from './codex-keychain'
import { CodexConfigProviderWriter } from './codex-config-provider'

// Codex 专用凭据注入：不走通用 {"token": ...} 格式（Codex 不识别），而是按官方
// auth.json 结构整写 + config.toml provider 段复位/接管 + macOS Keychain 同步
// （对照 cockpit-tools write_auth_file_to_dir + write_prepared_account_bundle_to_dir：
// auth.json/config.toml 必须成功，Keychain 失败降级告警）。
export class CodexCredentialInjectionPort implements CredentialInjectionPort {
  private readonly authPath: string
  private readonly keychain: CodexKeychainSync
  private readonly configProvider: CodexConfigProviderWriter

  constructor(
    authPath: string = codexAuthJsonPath(),
    keychain?: CodexKeychainSync,
    configProvider?: CodexConfigProviderWriter,
  ) {
    this.authPath = authPath
    this.keychain = keychain ?? createCodexKeychainSync(codexHomeDir())
    this.configProvider = configProvider ?? new CodexConfigProviderWriter()
  }

  async inject(_platform: PlatformId, credential: Credential): Promise<void> {
    const value = buildCodexAuthFileValue(credential)
    await atomicWrite(this.authPath, JSON.stringify(value, null, 2))

    // config.toml：OAuth 复位内置 OpenAI（清掉上一个 API Key 账号残留的 provider，
    // 否则切完仍按旧 bearer 路由到错账号）；API Key 写 codex_local_access provider。
    await this.configProvider.apply(credential)

    // API Key 账号不写 Keychain（与 cockpit-tools 一致）；OAuth 账号 upsert，
    // 失败只告警不阻断 —— auth.json 已写成，旧 Codex / 无 Keychain 环境照常生效。
    if (!isCodexApiKeyCredential(credential)) {
      try {
        await this.keychain.write(JSON.stringify(value))
      } catch (e) {
        console.warn(
          `[codex-switch] 写入 Codex Keychain 失败（auth.json 已更新，新版 Codex 可能仍读到旧登录）: ${
            e instanceof Error ? e.message : String(e)
          }`,
        )
      }
    }
  }
}
