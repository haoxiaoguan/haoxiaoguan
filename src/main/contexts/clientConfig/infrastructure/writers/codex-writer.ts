// Codex 写入器（additive 模式，多供应商共存注入）。
// 写 ~/.codex/config.toml：每份接入档注入独立 [model_providers.<hxg-id>] + [profiles.<hxg-id>]，
// 共存（号小管账号档与第三方档可同时配置）；setDefault 写顶层 model_provider + model。
// 第三方/反代 key 入 [model_providers.<id>].experimental_bearer_token。
// ~/.codex/auth.json「只补空、绝不覆盖」：仅当其无任何登录凭证（无 ChatGPT tokens 也无
// OPENAI_API_KEY，此时桌面 App 连登录墙都过不去）时写入 OPENAI_API_KEY=供应商 key 让 App 可进
//（API 登录方式）；已有任何凭证一概不动（保 ChatGPT 登录态）；清除注入时不回收（回收会把用户
// 重新锁在 App 外）。auth.json 在 configFiles 中、纳入写前快照可回滚。
//
// L2「中转注入」：当 settings.codexCatalogModels 提供（非空数组）时，额外
//   ① 生成 catalog 文件（appDataDir 受控区，非 ~/.codex）写入非原生模型条目；
//   ② config.toml 顶层 model_catalog_json 指向该文件，
// 使 Codex /model 同时列出原生（models_cache）+ 账号池/第三方模型。清理本档时移除该指向。
import type { ClientConfigWriter, ApplyInput, FileBundle, WriteLifecycle } from '../../domain/client-writer'
import {
  parseCodexToml,
  stringifyCodexToml,
  codexProviderId,
  upsertCodexProvider,
  removeCodexProvider,
  setCodexModelCatalogPath,
  clearCodexModelCatalogPath,
  getCodexModelCatalogPath,
} from '../codex-toml'
import { buildCodexModelCatalogFile, type CatalogModelInput } from '../codex-model-catalog'

/** 从 ApplyInput.settings 读出 L2 catalog 模型清单（非数组/空 → undefined）。 */
// 返回值语义：键**缺失/非数组** → undefined（不写 catalog，L1 切换式）；
// 键存在（哪怕空数组）→ 返回数组（写 catalog；原生由 buildCodexModelCatalogFile 恒含，L2 路由器）。
function readCatalogModels(settings: Record<string, unknown> | undefined): CatalogModelInput[] | undefined {
  const raw = settings?.codexCatalogModels
  if (!Array.isArray(raw)) return undefined
  const models: CatalogModelInput[] = []
  for (const item of raw) {
    if (item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string') {
      const m = item as { id: string; displayName?: unknown; contextLength?: unknown }
      models.push({
        id: m.id,
        ...(typeof m.displayName === 'string' ? { displayName: m.displayName } : {}),
        ...(typeof m.contextLength === 'number' ? { contextLength: m.contextLength } : {}),
      })
    }
  }
  return models
}

export class CodexWriter implements ClientConfigWriter {
  readonly clientId = 'codex' as const
  readonly writeMode = 'additive' as const
  // 桌面 App 停-写-启生命周期（container 注入）。运行中的 Codex App 会反写 config.toml，
  // 必须停 App→写→重启它才会采纳；其它客户端无此钩子。
  readonly lifecycle?: WriteLifecycle
  private readonly configPath: string
  private readonly catalogPath: string
  private readonly authPath: string

  constructor(configPath: string, catalogPath: string, authPath: string, lifecycle?: WriteLifecycle) {
    this.configPath = configPath
    this.catalogPath = catalogPath
    this.authPath = authPath
    this.lifecycle = lifecycle
  }

  configFiles(): string[] {
    // 三文件全部纳入快照体系（auth.json 仅「补空」写、但同样可回滚）。
    return [this.configPath, this.catalogPath, this.authPath]
  }

  /** auth.json「只补空」：详见文件头注释。返回空对象=本次不动 auth.json。 */
  private renderAuthFill(current: FileBundle, apiKey: string): FileBundle {
    if (apiKey.length === 0) return {}
    const raw = current[this.authPath] ?? null
    let existing: Record<string, unknown> = {}
    if (raw !== null && raw.trim() !== '') {
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch {
        return {} // 损坏不动（不阻断 provider 注入）
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
      existing = parsed as Record<string, unknown>
    }
    const hasOauth = existing.tokens !== undefined && existing.tokens !== null
    const hasApiKey = typeof existing.OPENAI_API_KEY === 'string' && existing.OPENAI_API_KEY.length > 0
    if (hasOauth || hasApiKey) return {}
    return { [this.authPath]: `${JSON.stringify({ ...existing, OPENAI_API_KEY: apiKey }, null, 2)}\n` }
  }

  renderApply(current: FileBundle, input: ApplyInput): FileBundle {
    let obj = parseCodexToml(current[this.configPath] ?? null, this.configPath)
    obj = upsertCodexProvider(obj, {
      id: codexProviderId(input.profileId),
      name: input.name,
      baseUrl: input.baseUrl,
      bearerToken: input.apiKey,
      ...(input.model !== undefined ? { model: input.model } : {}),
      isDefault: input.isDefault === true,
      // 「完整 URL」开关由 settings.fullUrl 透传（ApplyInput.settings 恒含 profile.settings）：
      // true=base_url 原样写入(不补 /v1)，否则启发式。预览/注入同源，不另设 ApplyInput 字段。
      fullUrl: input.settings?.fullUrl === true,
    })

    const authFill = this.renderAuthFill(current, input.apiKey)
    const catalogModels = readCatalogModels(input.settings)
    if (catalogModels !== undefined) {
      // 写 catalog 文件 + 指向它。includeNative：中转注入 ON 才把原生 gpt 并入菜单(真共存)，
      // OFF(切换式)只列本供应商模型(原生被替换)。默认 true(向后兼容)。
      const includeNative = input.settings?.codexCatalogIncludeNative !== false
      obj = setCodexModelCatalogPath(obj, this.catalogPath)
      return {
        [this.configPath]: stringifyCodexToml(obj),
        [this.catalogPath]: buildCodexModelCatalogFile(catalogModels, { includeNative }),
        ...authFill,
      }
    }
    return { [this.configPath]: stringifyCodexToml(obj), ...authFill }
  }

  renderClear(current: FileBundle, profileId: string): FileBundle {
    const raw = current[this.configPath] ?? null
    if (raw === null) return {}
    const obj = parseCodexToml(raw, this.configPath)
    const removed = removeCodexProvider(obj, codexProviderId(profileId))
    // 若 model_catalog_json 指向号小管管理路径，一并移除（清空 catalog 文件，避免悬挂引用）。
    const cleared = getCodexModelCatalogPath(removed) === this.catalogPath
    // 语义无变更检测（不用 TOML 字符串比较——round-trip 会重排格式造成误判）：provider 块本就不存在
    // (removeCodexProvider 无改动) 且 catalog 未指向号小管 → 真没东西可清，返回 {} 让 applier 跳过
    // 停-写-启，避免「无任何供应商时切换中转注入也重启 Codex」。
    if (!cleared && JSON.stringify(removed) === JSON.stringify(obj)) return {}
    if (cleared) {
      const next = clearCodexModelCatalogPath(removed, this.catalogPath)
      return {
        [this.configPath]: stringifyCodexToml(next),
        [this.catalogPath]: buildCodexModelCatalogFile([]),
      }
    }
    return { [this.configPath]: stringifyCodexToml(removed) }
  }
}
