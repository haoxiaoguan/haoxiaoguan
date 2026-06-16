// 原生（ChatGPT 登录账号）上游：
//   - 作为 PlatformUpstreamAdapter 注册（platform='codex-native'），把原生模型暴露进 /v1/models。
//   - 作为 CodexNativePassthrough，对 /v1/responses 的原生模型做 HTTP 级**原始透传**到
//     https://chatgpt.com/backend-api/codex/responses（OAuth Bearer + chatgpt-account-id），
//     SSE 帧不缓冲、原样回吐；不转 IR、不动 store，最大保真。
//   - chat/chatStream（IR 路）不支持：Codex 只走 Responses；命中即清晰报错。
//
// token 生命周期由 CodexNativeTokenManager 负责（读 auth.json 播种、自管刷新、不写 auth.json）。
// egress 复用 RelayUpstreamClient（任意 headers + ambient dispatcher 出站代理）。
// bytecode 安全：无 class-property 箭头初始化，纯方法。
import type {
  ErrorClass,
  ModelInfo,
  PlatformUpstreamAdapter,
  UpstreamCtx,
} from '../../../domain/platform-adapter'
import type {
  CanonicalRequest,
  CanonicalResponse,
  CanonicalStreamEvent,
} from '../../../domain/canonical'
import type {
  CodexNativePassthrough,
  CodexNativeProxyInput,
  CodexNativeResult,
} from '../../../domain/codex-native-passthrough'
import type { CodexNativeTokenManager } from './codex-native-token-manager'

/** ChatGPT 后端 Responses 端点（原生 OAuth 透传目标）。 */
export const CHATGPT_RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses'

/** egress HTTP 能力（RelayUpstreamClient 结构满足；窄接口便于测试）。 */
export interface CodexNativeHttp {
  post(
    url: string,
    headers: Record<string, string>,
    bodyJson: unknown,
  ): Promise<{ status: number; json(): Promise<unknown> }>
  postStream(
    url: string,
    headers: Record<string, string>,
    bodyJson: unknown,
  ): Promise<{ status: number; chunks(): AsyncIterable<string> }>
}

/** 透传时不向上游转发的入站头（鉴权/传输层由我们重写/重算）。 */
const FORWARD_DENY = new Set([
  'host',
  'authorization',
  'content-length',
  'connection',
  'accept-encoding',
  'x-api-key',
  'x-goog-api-key',
])

export interface CodexNativeUpstreamOpts {
  tokens: CodexNativeTokenManager
  http: CodexNativeHttp
  models: ModelInfo[]
}

export class CodexNativeUpstream implements PlatformUpstreamAdapter, CodexNativePassthrough {
  readonly platform = 'codex-native'
  private readonly tokens: CodexNativeTokenManager
  private readonly http: CodexNativeHttp
  private readonly models: ModelInfo[]
  private readonly modelIds: Set<string>

  constructor(opts: CodexNativeUpstreamOpts) {
    this.tokens = opts.tokens
    this.http = opts.http
    this.models = opts.models.slice()
    this.modelIds = new Set(this.models.map((m) => m.id))
  }

  isNativeModel(model: string | undefined): boolean {
    return typeof model === 'string' && this.modelIds.has(model)
  }

  supportsModel(model: string): boolean {
    return this.modelIds.has(model)
  }

  listModels(): ModelInfo[] {
    return this.models.slice()
  }

  // ---- 原生透传 ----
  async proxyResponses(input: CodexNativeProxyInput): Promise<CodexNativeResult> {
    const tok = await this.tokens.ensureToken()
    try {
      return await this.send(input, tok.accessToken, tok.accountId)
    } catch (e) {
      // 上游 401：刷新一次后重试（access_token 可能刚过期）。
      if (isUnauthorized(e)) {
        const t = await this.tokens.forceRefresh()
        return await this.send(input, t.accessToken, t.accountId)
      }
      throw e
    }
  }

  private async send(
    input: CodexNativeProxyInput,
    accessToken: string,
    accountId: string,
  ): Promise<CodexNativeResult> {
    const headers = buildUpstreamHeaders(input.headers ?? {}, accessToken, accountId)
    if (input.stream) {
      const resp = await this.http.postStream(CHATGPT_RESPONSES_URL, headers, input.body)
      return { status: resp.status, stream: resp.chunks() }
    }
    const resp = await this.http.post(CHATGPT_RESPONSES_URL, headers, input.body)
    return { status: resp.status, body: await resp.json() }
  }

  // ---- IR 路（不支持；Codex 仅用 Responses）----
  chat(_ir: CanonicalRequest, _ctx: UpstreamCtx): Promise<CanonicalResponse> {
    return Promise.reject(
      new CodexNativeUnsupportedError('codex-native models are served via /v1/responses only'),
    )
  }

  async *chatStream(_ir: CanonicalRequest, _ctx: UpstreamCtx): AsyncIterable<CanonicalStreamEvent> {
    throw new CodexNativeUnsupportedError('codex-native models are served via /v1/responses only')
  }

  classifyError(err: unknown): ErrorClass {
    const e = err as { name?: string; status?: number }
    if (e?.name === 'CodexNativeNoLoginError') return 'AUTH'
    if (e?.name === 'RelayHttpError') {
      const s = e.status
      if (s === 402) return 'QUOTA' // 额度耗尽：冷却到配额重置时间
      if (s === 429) return 'RATE_LIMIT'
      if (s === 401 || s === 403) return 'AUTH'
      if (s === 400 || s === 422) return 'FATAL'
      return 'SERVER'
    }
    return 'SERVER'
  }
}

/** 非 Responses 路命中原生模型时抛出（Codex 不会触发）。 */
export class CodexNativeUnsupportedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CodexNativeUnsupportedError'
  }
}

function isUnauthorized(e: unknown): boolean {
  const err = e as { name?: string; status?: number }
  return err?.name === 'RelayHttpError' && err.status === 401
}

/** 构造透传上游头：保真转发入站头（去鉴权/传输层），并注入 OAuth 鉴权 + account-id。 */
function buildUpstreamHeaders(
  incoming: Record<string, string>,
  accessToken: string,
  accountId: string,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(incoming)) {
    if (FORWARD_DENY.has(k.toLowerCase())) continue
    out[k] = v
  }
  out['authorization'] = `Bearer ${accessToken}`
  out['chatgpt-account-id'] = accountId
  if (out['content-type'] === undefined) out['content-type'] = 'application/json'
  if (out['openai-beta'] === undefined) out['openai-beta'] = 'responses=experimental'
  if (out['originator'] === undefined) out['originator'] = 'codex_cli_rs'
  return out
}
