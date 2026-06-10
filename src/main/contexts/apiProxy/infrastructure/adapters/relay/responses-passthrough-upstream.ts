// responses-passthrough-upstream.ts
// 面向第三方 responses 上游的 HTTP 级透传适配器：
//   - 把入站 /v1/responses 请求体原样转发到第三方 {baseUrl}/responses，
//     替换 Authorization: Bearer <第三方 key>，SSE/非流式都支持。
//   - 持有 models: Array<{ alias: string; real: string }>：
//     alias 可能等于 real（无别名），转发前把请求体 model 字段从 alias 映射回 real。
//   - supportsModel/listModels 按 alias 暴露（alias 即 catalog 里的 slug）。
//   - chat/chatStream（IR 路）不支持：Codex 只走 Responses，命中即清晰报错（对齐 codex-native 模式）。
//   - 出站请求走项目统一的 RelayUpstreamClient（ambient dispatcher + undici fetch，保证代理穿透）。
// bytecode 安全：无 class-property 箭头初始化，纯方法。
import type {
  PlatformUpstreamAdapter,
  ModelInfo,
  UpstreamCtx,
  ErrorClass,
} from '../../../domain/platform-adapter'
import type { CanonicalRequest, CanonicalResponse, CanonicalStreamEvent } from '../../../domain/canonical'
import type { CodexNativePassthrough, CodexNativeProxyInput, CodexNativeResult } from '../../../domain/codex-native-passthrough'
import type { RelayUpstreamClient } from './relay-upstream-client'

/** 不向上游转发的入站头（鉴权/传输层）。 */
const FORWARD_DENY = new Set([
  'host',
  'authorization',
  'content-length',
  'connection',
  'accept-encoding',
  'x-api-key',
  'x-goog-api-key',
])

/** 模型别名条目：alias 是 catalog slug（暴露给外部），real 是上游实际 model id。 */
export interface ResponsesPassthroughModelEntry {
  alias: string
  real: string
}

export interface ResponsesPassthroughUpstreamOpts {
  /** 平台标识，唯一。 */
  platform: string
  /** 第三方上游 base URL（如 https://api.openai.com/v1）。末尾斜杠自动处理。 */
  baseUrl: string
  /** 第三方 API Key（出站时注入 Authorization 头；不进日志）。 */
  apiKey: string
  /** 模型列表；alias 为 catalog slug，real 为上游真实 id（可与 alias 相同）。 */
  models: ResponsesPassthroughModelEntry[]
  /** 传输层客户端（RelayUpstreamClient 接口满足，窄接口便于测试）。 */
  client: RelayUpstreamClient
}

/**
 * responses 第三方 HTTP 级透传适配器。
 * 实现 PlatformUpstreamAdapter（进 PlatformRegistry）+ CodexNativePassthrough 同名端口，
 * 供 ApiProxyService 的 openai-responses 分支统一调用 proxyResponses。
 */
export class ResponsesPassthroughUpstream implements PlatformUpstreamAdapter, CodexNativePassthrough {
  readonly platform: string
  private readonly baseUrl: string
  private readonly apiKey: string
  private readonly models: ResponsesPassthroughModelEntry[]
  private readonly client: RelayUpstreamClient
  /** alias → real 映射（快速查找）。 */
  private readonly aliasToReal: Map<string, string>

  constructor(opts: ResponsesPassthroughUpstreamOpts) {
    this.platform = opts.platform
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '')
    this.apiKey = opts.apiKey
    this.models = opts.models.slice()
    this.client = opts.client
    this.aliasToReal = new Map(opts.models.map((m) => [m.alias, m.real]))
  }

  /** 该 alias（catalog slug）是否归本适配器所有。 */
  isNativeModel(model: string | undefined): boolean {
    return typeof model === 'string' && this.aliasToReal.has(model)
  }

  supportsModel(model: string): boolean {
    return this.aliasToReal.has(model)
  }

  listModels(): ModelInfo[] {
    return this.models.map((m) => ({ id: m.alias }))
  }

  /** 透传 Responses 请求到第三方上游（alias→real 映射 + Bearer 替换 + SSE 不缓冲）。 */
  async proxyResponses(input: CodexNativeProxyInput): Promise<CodexNativeResult> {
    const url = `${this.baseUrl}/responses`
    const headers = buildPassthroughHeaders(input.headers ?? {}, this.apiKey)

    // 把请求体 model 字段从 alias 映射回上游真实 id。
    const body = rewriteModelAlias(input.body, this.aliasToReal)

    if (input.stream) {
      const resp = await this.client.postStream(url, headers, body)
      return { status: resp.status, stream: resp.chunks() }
    }
    const resp = await this.client.post(url, headers, body)
    return { status: resp.status, body: await resp.json() }
  }

  // ---- IR 路（不支持；Codex 仅用 Responses）----
  chat(_ir: CanonicalRequest, _ctx: UpstreamCtx): Promise<CanonicalResponse> {
    return Promise.reject(
      new ResponsesPassthroughUnsupportedError('responses-passthrough 上游仅支持 /v1/responses 透传，不支持 chat IR 路'),
    )
  }

  async *chatStream(_ir: CanonicalRequest, _ctx: UpstreamCtx): AsyncIterable<CanonicalStreamEvent> {
    throw new ResponsesPassthroughUnsupportedError('responses-passthrough 上游仅支持 /v1/responses 透传，不支持 chatStream IR 路')
  }

  classifyError(err: unknown): ErrorClass {
    const e = err as { name?: string; status?: number }
    if (e?.name === 'RelayHttpError') {
      const s = e.status
      if (s === 429) return 'RATE_LIMIT'
      if (s === 401 || s === 403) return 'AUTH'
      if (s === 400 || s === 422) return 'FATAL'
      return 'SERVER'
    }
    return 'SERVER'
  }
}

/** chat/chatStream 命中时抛出（透传路不走 IR）。 */
export class ResponsesPassthroughUnsupportedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ResponsesPassthroughUnsupportedError'
  }
}

/** 构造透传出站头：保真转发入站头（去鉴权/传输层），注入第三方 Bearer Key。 */
function buildPassthroughHeaders(
  incoming: Record<string, string>,
  apiKey: string,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(incoming)) {
    if (FORWARD_DENY.has(k.toLowerCase())) continue
    out[k] = v
  }
  // 注入第三方鉴权（凭证不进日志，仅注入 header）。
  out['authorization'] = `Bearer ${apiKey}`
  if (out['content-type'] === undefined) out['content-type'] = 'application/json'
  return out
}

/**
 * 把请求体中的 model 字段从 alias 映射回上游真实 id。
 * 仅替换 model 字段，其余字段原样透传。若 alias 找不到对应真名则保持原值。
 */
function rewriteModelAlias(
  body: unknown,
  aliasToReal: Map<string, string>,
): unknown {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return body
  const b = body as Record<string, unknown>
  if (typeof b.model !== 'string') return body
  const real = aliasToReal.get(b.model)
  if (real === undefined || real === b.model) return body
  return { ...b, model: real }
}
