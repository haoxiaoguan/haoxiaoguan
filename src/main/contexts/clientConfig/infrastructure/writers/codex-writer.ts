// Codex 写入器（additive 模式，多供应商共存注入）。
// 只写 ~/.codex/config.toml：每份接入档注入独立 [model_providers.<hxg-id>] + [profiles.<hxg-id>]，
// 共存（号小管账号档与第三方档可同时配置）；setDefault 写顶层 model_provider + model。
// 第三方/反代 key 入 [model_providers.<id>].experimental_bearer_token——绝不触碰 ~/.codex/auth.json，
// 以保住用户的 ChatGPT 登录态。MVP 暂不生成 model_catalog_json（模型仍可用，/model 选择器枚举增强留后）。
import type { ClientConfigWriter, ApplyInput, FileBundle } from '../../domain/client-writer'
import {
  parseCodexToml,
  stringifyCodexToml,
  codexProviderId,
  upsertCodexProvider,
  removeCodexProvider,
} from '../codex-toml'

/** Codex provider 的 wire_api 默认值（号小管反代支持 Responses API；个别第三方可能需改 'chat'）。 */
const DEFAULT_WIRE_API = 'responses'

export class CodexWriter implements ClientConfigWriter {
  readonly clientId = 'codex' as const
  readonly writeMode = 'additive' as const
  private readonly configPath: string

  constructor(configPath: string) {
    this.configPath = configPath
  }

  configFiles(): string[] {
    // 只声明 config.toml：auth.json 故意不纳入（从不修改，保 ChatGPT 登录）。
    return [this.configPath]
  }

  renderApply(current: FileBundle, input: ApplyInput): FileBundle {
    const obj = parseCodexToml(current[this.configPath] ?? null, this.configPath)
    const next = upsertCodexProvider(obj, {
      id: codexProviderId(input.profileId),
      name: input.name,
      baseUrl: input.baseUrl,
      wireApi: DEFAULT_WIRE_API,
      bearerToken: input.apiKey,
      ...(input.model !== undefined ? { model: input.model } : {}),
      isDefault: input.isDefault === true,
    })
    return { [this.configPath]: stringifyCodexToml(next) }
  }

  renderClear(current: FileBundle, profileId: string): FileBundle {
    const raw = current[this.configPath] ?? null
    if (raw === null) return {}
    const obj = parseCodexToml(raw, this.configPath)
    const next = removeCodexProvider(obj, codexProviderId(profileId))
    return { [this.configPath]: stringifyCodexToml(next) }
  }
}
