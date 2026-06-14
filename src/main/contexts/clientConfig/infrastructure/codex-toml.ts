// Codex config.toml 受控读写工具（纯函数）。基于 @iarna/toml 解析/序列化。
// 不变式：只动属于号小管的 [model_providers.<hxg-id>] / [profiles.<hxg-id>] 段与（指向本档时的）
// 顶层 model_provider/model，保留用户其余 provider/profile/mcp_servers/注释外的所有键。
// 注意：@iarna/toml 序列化不保留注释（重排数据但不丢键）——MVP 接受此权衡。
import TOML from '@iarna/toml'
import { ClientConfigCorruptError } from '../domain/client-writer'
import { resolveApiBaseUrl } from './api-base-url'

/** Codex 内置 provider id（不可被号小管合成同名表）。 */
export const CODEX_RESERVED_PROVIDER_IDS = new Set([
  'amazon-bedrock',
  'openai',
  'ollama',
  'lmstudio',
  'oss',
  'ollama-chat',
])

/** 本档在 config.toml 中的 provider/profile 键（稳定、TOML 裸键安全、可识别为号小管所写）。 */
export function codexProviderId(profileId: string): string {
  return `hxg_${profileId.replace(/[^a-zA-Z0-9]/g, '')}`
}

/** 解析 config.toml：null/空 → {}；解析失败 → 抛 ClientConfigCorruptError（拒绝覆盖损坏文件）。 */
export function parseCodexToml(raw: string | null, file: string): Record<string, unknown> {
  if (raw === null || raw.trim() === '') return {}
  try {
    return TOML.parse(raw) as Record<string, unknown>
  } catch {
    throw new ClientConfigCorruptError(file, `Codex config.toml 解析失败，拒绝写入：${file}`)
  }
}

export function stringifyCodexToml(obj: Record<string, unknown>): string {
  // @iarna/toml 的 stringify 接受 JsonMap;此处对象均为可序列化结构。
  return TOML.stringify(obj as TOML.JsonMap)
}

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

export interface CodexProviderInput {
  /** provider/profile 键（codexProviderId 产出）。 */
  id: string
  /** 显示名。 */
  name: string
  baseUrl: string
  /** 明文 key（写进 experimental_bearer_token；空则不写）。 */
  bearerToken: string
  model?: string
  /** 是否设为顶层默认（model_provider + model）。 */
  isDefault: boolean
  /** 「完整 URL」：true=base_url 原样用（不补 /v1）；false/缺省=启发式补 /v1。 */
  fullUrl?: boolean
}

/**
 * Codex provider base_url 规范化：请求 = POST {base_url}/responses，OpenAI 兼容上游惯例须以 /v1
 * 结尾（用户实证：填 http://127.0.0.1:8080 会打到 :8080/responses 而非 :8080/v1/responses）。
 * 启发式（仅 URL 无路径时补 /v1，带路径原样）。统一委托 resolveApiBaseUrl(url, false) —— 与测连通/
 * 拉模型/relay 上游同源，避免「测试与真实请求补路径规则不一致」。credential-injection 的账号注入仍调本
 * 函数（无「完整 URL」开关，恒走启发式）。
 */
export function normalizeCodexBaseUrl(url: string): string {
  return resolveApiBaseUrl(url, false)
}

/** 注入/更新一段号小管 provider + 对应 profile（保留其余键）。 */
export function upsertCodexProvider(
  obj: Record<string, unknown>,
  input: CodexProviderInput,
): Record<string, unknown> {
  const next = { ...obj }

  const providers = { ...asRecord(next.model_providers) }
  const provider: Record<string, unknown> = {
    name: input.name,
    base_url: resolveApiBaseUrl(input.baseUrl, input.fullUrl ?? false),
    // Codex 已彻底移除 wire_api="chat"：任何 provider 段带它都会让整个 config.toml 解析失败、
    // 用户的 Codex 直接起不来（真机证实，见 openai/codex discussions#7782）。唯一合法值恒为
    // responses，故不提供参数；chat-only 上游必须经号小管反代做协议转换。
    wire_api: 'responses',
    // 恒 true（2026-06-10 用户真机实证的 working recipe 取值）：登录状态显示由 auth.json 驱动、
    // 与本键无关；false 是早期 6 次「App 菜单不显示」失败实验的头号嫌疑变量。请求鉴权由
    // experimental_bearer_token 决定（provider 私有 key 优先于 auth.json 的 OPENAI_API_KEY 兜底）。
    requires_openai_auth: true,
    // 强制 HTTP-only —— Codex 0.135+ 桌面 App 默认走 WebSocket 传输,
    // 自定义 HTTP provider 不声明此键就连不上 → App 崩(无模型/无登录)。必须显式关闭。
    supports_websockets: false,
  }
  if (input.bearerToken.length > 0) provider.experimental_bearer_token = input.bearerToken
  providers[input.id] = provider
  next.model_providers = providers

  const profiles = { ...asRecord(next.profiles) }
  const profile: Record<string, unknown> = { model_provider: input.id }
  if (input.model !== undefined && input.model.length > 0) profile.model = input.model
  profiles[input.id] = profile
  next.profiles = profiles

  if (input.isDefault) {
    next.model_provider = input.id
    // 有模型才设 model;无模型时清除残留 model,避免 model_provider→本档、model→他档模型的脏指针。
    if (input.model !== undefined && input.model.length > 0) next.model = input.model
    else delete next.model
  }
  return next
}

/** 设置顶层 model_catalog_json 指向号小管管理的 catalog 文件（L2 中转注入用）。 */
export function setCodexModelCatalogPath(obj: Record<string, unknown>, path: string): Record<string, unknown> {
  return { ...obj, model_catalog_json: path }
}

/** 仅当 model_catalog_json 指向号小管管理路径时移除它（不动用户自设的 catalog）。 */
export function clearCodexModelCatalogPath(obj: Record<string, unknown>, ourPath: string): Record<string, unknown> {
  if (obj.model_catalog_json !== ourPath) return obj
  const next = { ...obj }
  delete next.model_catalog_json
  return next
}

/** 读当前 model_catalog_json 值（用于判断是否号小管所写）。 */
export function getCodexModelCatalogPath(obj: Record<string, unknown>): string | undefined {
  return typeof obj.model_catalog_json === 'string' ? obj.model_catalog_json : undefined
}

/** 移除一段号小管 provider + profile；若顶层默认指向本档则一并清除（不动他档/用户设定）。 */
export function removeCodexProvider(obj: Record<string, unknown>, id: string): Record<string, unknown> {
  const next = { ...obj }
  if (typeof next.model_providers === 'object' && next.model_providers !== null) {
    const providers = { ...asRecord(next.model_providers) }
    delete providers[id]
    next.model_providers = providers
  }
  if (typeof next.profiles === 'object' && next.profiles !== null) {
    const profiles = { ...asRecord(next.profiles) }
    delete profiles[id]
    next.profiles = profiles
  }
  if (next.model_provider === id) {
    delete next.model_provider
    delete next.model
  }
  return next
}

/** 读 config.toml 顶层默认 provider(Codex resume/Desktop 据此过滤可见性)。 */
export function getCodexDefaultProvider(obj: Record<string, unknown>): string | undefined {
  return typeof obj.model_provider === 'string' && obj.model_provider.length > 0 ? obj.model_provider : undefined
}
