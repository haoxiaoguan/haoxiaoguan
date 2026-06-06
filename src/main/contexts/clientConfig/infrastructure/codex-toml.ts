// Codex config.toml 受控读写工具（纯函数）。基于 @iarna/toml 解析/序列化。
// 不变式：只动属于号小管的 [model_providers.<hxg-id>] / [profiles.<hxg-id>] 段与（指向本档时的）
// 顶层 model_provider/model，保留用户其余 provider/profile/mcp_servers/注释外的所有键。
// 注意：@iarna/toml 序列化不保留注释（重排数据但不丢键）——MVP 接受此权衡。
import TOML from '@iarna/toml'
import { ClientConfigCorruptError } from '../domain/client-writer'

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
  /** 'responses' | 'chat'。 */
  wireApi: string
  /** 明文 key（写进 experimental_bearer_token；空则不写）。 */
  bearerToken: string
  model?: string
  /** 是否设为顶层默认（model_provider + model）。 */
  isDefault: boolean
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
    base_url: input.baseUrl,
    wire_api: input.wireApi,
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
    if (input.model !== undefined && input.model.length > 0) next.model = input.model
  }
  return next
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
