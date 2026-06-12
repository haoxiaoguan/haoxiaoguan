import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { JsonValue } from '../../contexts/account/domain/platform-account-profile'
import type { Credential } from '../../contexts/account/domain/credential'
import { atomicWrite } from '../../platform/fs/atomic-write'
import {
  parseCodexToml,
  stringifyCodexToml,
  normalizeCodexBaseUrl,
} from '../../contexts/clientConfig/infrastructure/codex-toml'
import { codexHomeDir, isCodexApiKeyCredential } from './codex-auth-file'

// Codex 切换账号时的 config.toml provider 段处理（对照 cockpit-tools
// write_auth_file_to_dir 里 auth.json 之后那段）：
//   - OAuth 账号：复位为内置 OpenAI —— 删掉号小管「受管」的 API Key provider 块
//     （codex_local_access 等），否则切完 Codex 仍按上一个 API Key 账号的
//     experimental_bearer_token 路由到错账号。
//   - API Key 账号：写 [model_providers.codex_local_access]，bearer = 该账号 key，
//     base_url = 账号自带或默认 openai/v1，并把顶层 model_provider 指向它。
// 不变式：只动「受管」provider id（下表）+ 指向它们的顶层 model_provider；
// 用户/clientConfig 注入的 hxg_* / 其它 provider 一律保留（与 cockpit
// collect_managed_api_key_provider_ids 同源，但更保守：仅在 model_provider 命中
// 受管 id 时才清顶层，避免误清「客户端接入」累加注入的默认档）。

const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1'
const RUNTIME_MODEL_PROVIDER_ID = 'codex_local_access'
const DEFAULT_RUNTIME_PROVIDER_NAME = 'Codex Local Access'
const PROVIDER_WIRE_API = 'responses'
const MODEL_PROVIDER_KEY = 'model_provider'
const MODEL_PROVIDERS_KEY = 'model_providers'
const OPENAI_BASE_URL_KEY = 'openai_base_url'
const BEARER_TOKEN_KEY = 'experimental_bearer_token'

// 切号会复位/接管的「受管」provider id（与 cockpit 一致 + 运行时 id）。
const MANAGED_PROVIDER_IDS = new Set([
  RUNTIME_MODEL_PROVIDER_ID,
  'cockpit_api',
  'openai_api_key',
])

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function metadataString(credential: Credential, keys: string[]): string | undefined {
  const meta = credential.rawMetadata
  if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) return undefined
  const rec = meta as Record<string, JsonValue>
  for (const k of keys) {
    const v = rec[k]
    if (typeof v === 'string' && v.trim().length > 0) return v.trim()
  }
  return undefined
}

function isDefaultOpenAiBaseUrl(url: string): boolean {
  const trimmed = url.trim().replace(/\/+$/, '')
  return trimmed === '' || trimmed === 'https://api.openai.com' || trimmed === DEFAULT_OPENAI_BASE_URL
}

/** OAuth 账号：复位内置 OpenAI —— 删受管 provider 块、清指向它们的顶层默认与 openai_base_url。 */
function resetToBuiltinOpenAi(obj: Record<string, unknown>): Record<string, unknown> {
  const next = { ...obj }

  if (typeof next[MODEL_PROVIDERS_KEY] === 'object' && next[MODEL_PROVIDERS_KEY] !== null) {
    const providers = { ...asRecord(next[MODEL_PROVIDERS_KEY]) }
    for (const id of MANAGED_PROVIDER_IDS) delete providers[id]
    if (Object.keys(providers).length === 0) delete next[MODEL_PROVIDERS_KEY]
    else next[MODEL_PROVIDERS_KEY] = providers
  }

  // 仅当顶层默认指向「受管」provider 时才清，避免误清客户端接入注入的 hxg_* 默认档。
  if (typeof next[MODEL_PROVIDER_KEY] === 'string' && MANAGED_PROVIDER_IDS.has(next[MODEL_PROVIDER_KEY] as string)) {
    delete next[MODEL_PROVIDER_KEY]
  }
  // 内置 OpenAI 用官方端点，清掉任何残留的自定义 openai_base_url。
  delete next[OPENAI_BASE_URL_KEY]
  return next
}

/** API Key 账号：写 codex_local_access provider（bearer + base_url）并指为顶层默认。 */
function writeApiKeyProvider(
  obj: Record<string, unknown>,
  bearerToken: string,
  baseUrl: string,
): Record<string, unknown> {
  const next = { ...obj }
  const providers = { ...asRecord(next[MODEL_PROVIDERS_KEY]) }
  providers[RUNTIME_MODEL_PROVIDER_ID] = {
    name: DEFAULT_RUNTIME_PROVIDER_NAME,
    base_url: baseUrl,
    wire_api: PROVIDER_WIRE_API,
    requires_openai_auth: true,
    [BEARER_TOKEN_KEY]: bearerToken,
    supports_websockets: false,
  }
  next[MODEL_PROVIDERS_KEY] = providers
  next[MODEL_PROVIDER_KEY] = RUNTIME_MODEL_PROVIDER_ID
  return next
}

/**
 * 纯函数：给定当前 config.toml 对象与凭据，算出切号后应写入的对象。
 * 导出供单测；返回 null 表示无需改动（避免无谓写盘）。
 */
export function computeCodexProviderConfig(
  current: Record<string, unknown>,
  credential: Credential,
): Record<string, unknown> {
  if (isCodexApiKeyCredential(credential)) {
    const apiKey = (metadataString(credential, ['api_key']) ?? credential.token).trim()
    if (apiKey.length === 0) throw new Error('Codex API Key 账号缺少可写入 provider 的密钥')
    const rawBase = metadataString(credential, ['base_url', 'api_base_url', 'apiBaseUrl'])
    const baseUrl =
      rawBase === undefined || isDefaultOpenAiBaseUrl(rawBase)
        ? DEFAULT_OPENAI_BASE_URL
        : normalizeCodexBaseUrl(rawBase)
    return writeApiKeyProvider(current, apiKey, baseUrl)
  }
  return resetToBuiltinOpenAi(current)
}

/** Codex config.toml provider 段写盘端口（路径可注入便于单测）。 */
export class CodexConfigProviderWriter {
  private readonly configPath: string

  constructor(configPath: string = join(codexHomeDir(), 'config.toml')) {
    this.configPath = configPath
  }

  async apply(credential: Credential): Promise<void> {
    const raw = existsSync(this.configPath) ? readFileSync(this.configPath, 'utf8') : null
    // OAuth 复位时若文件不存在且无受管块可清，跳过（保持与 cockpit「无需建空文件」一致）。
    if (raw === null && !isCodexApiKeyCredential(credential)) return
    const current = parseCodexToml(raw, this.configPath)
    const next = computeCodexProviderConfig(current, credential)
    await atomicWrite(this.configPath, stringifyCodexToml(next))
  }
}
