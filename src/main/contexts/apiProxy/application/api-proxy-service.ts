import type { ApiHttpServer } from '../infrastructure/http/api-http-server'
import type { PlatformRegistry } from '../infrastructure/platform-registry'
import { NoUpstreamError } from '../infrastructure/platform-registry'
import type { RequestIntent, RequestFormat, PlatformAliasResolver } from '../domain/request-intent'
import { resolveModelAlias } from '../domain/request-intent'
import { PLATFORM_NAME_TO_ALIAS } from '../domain/platform-alias'
import type { RouteCombo } from '../domain/route-combo'
import { enabledStepModels, COMBO_MODEL_PREFIX } from '../domain/route-combo'
import type { ComboSource } from './combo-service'
import { runComboChain } from './combo-orchestrator'
import type { UpstreamCtx } from '../domain/platform-adapter'
import { extractSessionHint } from '../domain/account-selection/session-hint'
import type {
  CanonicalRequest,
  CanonicalResponse,
  CanonicalStreamEvent,
} from '../domain/canonical'
import {
  openaiToIR,
  irToOpenAIResponse,
  serializeOpenAIStream,
  serializeOpenAIStreamLazy,
} from '../infrastructure/inbound/openai'
import {
  anthropicToIR,
  irToAnthropicResponse,
  serializeAnthropicStream,
  serializeAnthropicStreamLazy,
} from '../infrastructure/inbound/anthropic'
import {
  geminiToIR,
  irToGeminiResponse,
  serializeGeminiStream,
} from '../infrastructure/inbound/gemini'
import { responsesToIR, responsesCustomToolNames } from '../infrastructure/inbound/responses/responses-input'
import { irToResponsesResponse } from '../infrastructure/inbound/responses/responses-response'
import { serializeResponsesStream } from '../infrastructure/inbound/responses/responses-stream'
import type { CodexNativePassthrough } from '../domain/codex-native-passthrough'
import type { ResponsesPassthroughUpstream } from '../infrastructure/adapters/relay/responses-passthrough-upstream'
import { expandPreviousResponseHistory } from '../infrastructure/responses-store/responses-history'
import type { ResponsesStore, StoredResponseDoc } from '../infrastructure/responses-store/responses-store'
import type { ResponsesRequest } from '../infrastructure/inbound/responses/responses-types'
import type { ContentBlock } from '../domain/canonical'
import type { ApiProxyStatus } from '../../../../shared/api-types'
import { estimateRequestInputTokens } from '../domain/usage/token-estimator'
import type {
  ProxyRequestLog,
  ProxyRequestRecordInput,
  RequestObservation,
} from '../domain/observability/proxy-request-log'

// 入站转换器映射（可注入，便于测试替换；默认用 M2a 真实函数）。
export interface InboundConverters {
  openai: {
    toIR: typeof openaiToIR
    toResponse: typeof irToOpenAIResponse
    serializeStream: typeof serializeOpenAIStream
  }
  anthropic: {
    toIR: typeof anthropicToIR
    toResponse: typeof irToAnthropicResponse
    serializeStream: typeof serializeAnthropicStream
  }
  gemini: {
    toIR: typeof geminiToIR
    toResponse: typeof irToGeminiResponse
    serializeStream: typeof serializeGeminiStream
  }
}

export const DEFAULT_INBOUND_CONVERTERS: InboundConverters = {
  openai: { toIR: openaiToIR, toResponse: irToOpenAIResponse, serializeStream: serializeOpenAIStream },
  anthropic: { toIR: anthropicToIR, toResponse: irToAnthropicResponse, serializeStream: serializeAnthropicStream },
  gemini: { toIR: geminiToIR, toResponse: irToGeminiResponse, serializeStream: serializeGeminiStream },
}

// handleRequest 输入：路由意图 + 已解析 body + 调用方注入的稳定 requestId + 中止信号。
export interface HandleRequestInput {
  intent: RequestIntent
  body: unknown
  requestId: string
  signal?: AbortSignal
  headers?: Record<string, string>
  clientKeyId?: string
  /** 原始 HTTP method/path（hono 注入；仅用于 G3 请求日志展示，不参与编排）。 */
  method?: string
  path?: string
  /** 中转注入固定 key 命中（hono 注入）：该请求直连真实上游、跳过路由组合。 */
  injectionOrigin?: boolean
}

// 非流式 / 错误结果：直接作为 JSON 响应体。
export interface JsonResult {
  kind: 'json'
  status: number
  body: unknown
}

// 流式结果：已序列化的 wire 帧（惰性 AsyncIterable）+ content-type；由 hono handler 写出。
export interface StreamResult {
  kind: 'stream'
  status: number
  frames: AsyncIterable<string>
  contentType: string
}

export type HandleResult = JsonResult | StreamResult

// 业务错误：携带 HTTP 状态，供 hono onError 按 format 输出错误体。
export class ApiProxyHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly format: RequestFormat,
  ) {
    super(message)
    this.name = 'ApiProxyHttpError'
  }
}

/** 上游错误 → 语义化 HTTP 状态（修掉"全落 500"）。FATAL(400/422) 透传原状态。 */
export function classifyToHttp(err: unknown, format: RequestFormat): ApiProxyHttpError {
  if (err instanceof ApiProxyHttpError) return err
  const e = err as { name?: string; status?: number; message?: string }
  const msg = e?.message ?? 'upstream error'
  switch (e?.name) {
    case 'KiroUpstreamSuspendedError': return new ApiProxyHttpError(403, msg, format)
    case 'KiroUpstreamAuthError': return new ApiProxyHttpError(401, msg, format)
    case 'NoKiroAccountError':
    case 'NoHealthyAccountError': return new ApiProxyHttpError(503, msg, format)
    case 'KiroUpstreamError': {
      const s = e.status
      if (s === 429) return new ApiProxyHttpError(429, msg, format)
      if (s === 400 || s === 422) return new ApiProxyHttpError(s, msg, format)
      return new ApiProxyHttpError(502, msg, format)
    }
    default: return new ApiProxyHttpError(500, 'Internal server error', format)
  }
}

/** 原生透传错误 → HTTP（按 error.name，避免 application 反向依赖 infrastructure 错误类）。 */
export function classifyCodexNativeError(err: unknown): ApiProxyHttpError {
  if (err instanceof ApiProxyHttpError) return err
  const e = err as { name?: string; status?: number; message?: string }
  const msg = e?.message ?? 'codex-native upstream error'
  if (e?.name === 'CodexNativeNoLoginError') {
    return new ApiProxyHttpError(401, msg, 'openai-responses')
  }
  if (e?.name === 'RelayHttpError' && typeof e.status === 'number') {
    // 上游状态直透（401/403/429/4xx/5xx），保留语义。
    return new ApiProxyHttpError(e.status, msg, 'openai-responses')
  }
  return new ApiProxyHttpError(502, msg, 'openai-responses')
}

// 把异步事件流收集成数组（Gemini/Responses drain 路径仍使用）。
async function drainStream(
  stream: AsyncIterable<CanonicalStreamEvent>,
): Promise<CanonicalStreamEvent[]> {
  const events: CanonicalStreamEvent[] = []
  for await (const ev of stream) events.push(ev)
  return events
}

// Responses 真流式：首事件 peek 的宽限期 + 静默心跳间隔。
// 宽限期内上游若快速失败(鉴权/限流/模型不存在)→ 仍返回正常 HTTP 错误码；超过则不阻塞、立即开流。
const RESPONSES_FIRST_EVENT_GRACE_MS = 1500
// 上游静默(如 reasoning 思考)超过此间隔即发 SSE 注释心跳保活，需远小于客户端的事件间空闲超时。
const RESPONSES_STREAM_HEARTBEAT_MS = 5000

// 把 peek 出的首个 IteratorResult 和剩余 iterator 拼回一个完整 AsyncIterable。
// 用 try/finally 转发 return()，确保客户端断连/取消时上游 reader 锁和 timer 能被回收。
async function* prependFirst(
  first: IteratorResult<CanonicalStreamEvent>,
  it: AsyncIterator<CanonicalStreamEvent>,
): AsyncIterable<CanonicalStreamEvent> {
  try {
    if (!first.done) yield first.value
    while (true) {
      const n = await it.next()
      if (n.done) break
      yield n.value
    }
  } finally {
    if (typeof it.return === 'function') {
      try { await it.return() } catch { /* 忽略回收阶段错误 */ }
    }
  }
}

// 同 prependFirst，但首事件以"已发起的 it.next() promise"形式传入（用于 Responses 真流式：
// handleResponses 先 peek 首事件做宽限期错误分类，未命中错误时把该在途 promise 接回完整流，
// 不重复消费、不丢首事件）。首 promise 若稍后 reject（宽限期外才失败）→ 在此 await 抛出，
// 由上层序列化器以 response.failed 收尾。
async function* prependFirstFromPromise(
  firstP: Promise<IteratorResult<CanonicalStreamEvent>>,
  it: AsyncIterator<CanonicalStreamEvent>,
): AsyncIterable<CanonicalStreamEvent> {
  try {
    const first = await firstP
    if (!first.done) yield first.value
    while (true) {
      const n = await it.next()
      if (n.done) break
      yield n.value
    }
  } finally {
    if (typeof it.return === 'function') {
      try { await it.return() } catch { /* 忽略回收阶段错误 */ }
    }
  }
}

// apiProxy 上下文的 application 服务。包装 ApiHttpServer 提供 start/stop + 状态投影（M1），
// 并编排单请求链路 handleRequest（M2b）。语义对标 contexts/websocket/application/websocket-service.ts。
export class ApiProxyService {
  private readonly registry?: PlatformRegistry | undefined
  private readonly converters: InboundConverters
  // 原生（ChatGPT OAuth）透传：注入则对 /v1/responses 的原生模型走 HTTP 级原始透传（不转 IR）。
  private readonly codexNative?: CodexNativePassthrough | undefined
  // responses 第三方透传适配器列表：对 /v1/responses 的第三方模型走 HTTP 级透传到对应上游。
  private readonly responsesPassthroughs: ResponsesPassthroughUpstream[]
  // Responses 有状态持久化（previous_response_id 历史链 + store 落盘）；仅 /v1/responses 用。
  private readonly responsesStore?: ResponsesStore | undefined
  // 请求级可观测性（G3）：注入则记录每请求落点 + 累计计数器（喂 G10 /metrics）。
  private readonly observability?: ProxyRequestLog | undefined
  // 路由组合只读源（注入则支持「组合名当 model」的跨供应商降级链）。
  private readonly combos?: ComboSource | undefined
  // 模型别名解析器（把组合每一跳 `kr/x` 解析为 platform+model）；不注入则组合步骤按裸模型名路由。
  private readonly resolveAlias: PlatformAliasResolver
  // Phase 2 配额感知跳过：判定某平台池是否「确凿不可用」（kiro=池内无 available 账号）。
  // 用账号池健康（已反映超额：超额服务中的账号仍 available），故 nEnabled 超额池不会被误跳。
  private readonly isPlatformExhausted?: ((platform: string) => Promise<boolean>) | undefined
  private readonly clock: () => number
  // server 可后置注入（解循环依赖：container 先建 service 再建 listener+server，最后 attachServer）。
  // M1 单参构造 new ApiProxyService(server) 仍合法——server 既可构造传入也可 attach。
  private server?: ApiHttpServer | undefined

  constructor(
    server?: ApiHttpServer,
    deps: {
      registry?: PlatformRegistry
      converters?: InboundConverters
      responsesStore?: ResponsesStore
      observability?: ProxyRequestLog
      clock?: () => number
      codexNative?: CodexNativePassthrough
      responsesPassthroughs?: ResponsesPassthroughUpstream[]
      combos?: ComboSource
      resolvePlatformAlias?: PlatformAliasResolver
      isPlatformExhausted?: (platform: string) => Promise<boolean>
    } = {},
  ) {
    this.server = server
    this.registry = deps.registry
    this.converters = deps.converters ?? DEFAULT_INBOUND_CONVERTERS
    this.codexNative = deps.codexNative
    this.responsesPassthroughs = deps.responsesPassthroughs ?? []
    this.responsesStore = deps.responsesStore
    this.observability = deps.observability
    this.combos = deps.combos
    // 默认解析器：无前缀/未知前缀返回 undefined（步骤退化为裸模型名路由）。
    this.resolveAlias = deps.resolvePlatformAlias ?? (() => undefined)
    this.isPlatformExhausted = deps.isPlatformExhausted
    this.clock = deps.clock ?? Date.now
  }

  /**
   * 后置绑定 HTTP 监听器（解循环依赖：listener 需 service，service 又需 server）。
   * container 顺序：建 registry → 建 service（无 server）→ 建 listener（闭包引用 service）→
   * 建 ApiHttpServer(listener) → service.attachServer(server)。
   */
  attachServer(server: ApiHttpServer): void {
    this.server = server
  }

  async start(): Promise<void> {
    if (!this.server) throw new Error('ApiProxyService: server not attached')
    await this.server.start()
    this.observability?.markStarted()
  }

  async stop(): Promise<void> {
    // server 未 attach 时 stop 是安全 no-op（语义同「本就未启动」）。
    if (!this.server) return
    await this.server.stop()
    this.observability?.markStopped()
  }

  /**
   * 可路由模型 id 清单（别名前缀形式，如 `kr/claude-sonnet-4.5`）。供组合步骤选择器。
   * 与 /v1/models 同源（listAllModelsWithPlatform + 平台别名前缀），但只返回 id 串、不含组合本身。
   */
  listRoutableModels(): string[] {
    if (this.registry === undefined) return []
    return this.registry
      .listAllModelsWithPlatform()
      .filter(({ platform }) => platform !== 'echo') // echo 是占位/测试适配器，不暴露给用户
      .map(({ platform, model }) => {
        const alias = PLATFORM_NAME_TO_ALIAS.get(platform)
        return alias !== undefined ? `${alias}/${model.id}` : model.id
      })
  }

  getStatus(): ApiProxyStatus {
    // server 未 attach 时报 stopped、无端口（安全降级，不抛错）。
    if (!this.server) return { state: 'stopped' }
    const port = this.server.port
    const status: ApiProxyStatus = { state: this.server.getState() }
    if (port !== null) status.port = port
    return status
  }

  /**
   * 编排单个 API 请求。在 dispatch 外包一层可观测性（G3）：计时 + 选中账号/尝试次数
   * （经 obs 由 FailoverAdapter 回填）+ 成功/失败落 ProxyRequestLog（同时喂 G10 计数器）。
   * health/models 是本地应答、无上游账号，跳过记录以免噪声。
   */
  async handleRequest(input: HandleRequestInput): Promise<HandleResult> {
    if (input.intent.action === 'health' || input.intent.action === 'models') {
      return this.dispatch(input, { attempts: 0 })
    }
    const combo = this.matchCombo(input)
    const obs: RequestObservation = { attempts: 0 }
    const t0 = this.clock()
    try {
      const result = combo
        ? await this.dispatchCombo(combo, input, obs)
        : await this.dispatch(input, obs)
      this.observability?.record(
        this.buildRecord(input, obs, result.status, result.kind === 'stream', this.clock() - t0, true),
      )
      return result
    } catch (err) {
      const status = err instanceof ApiProxyHttpError ? err.status : 500
      const message = err instanceof Error ? err.message : String(err)
      this.observability?.record(
        this.buildRecord(input, obs, status, false, this.clock() - t0, false, message),
      )
      throw err
    }
  }

  /**
   * 命中路由组合判定：仅当 model 是无别名前缀的裸名（intent.platform 未设）、动作为 chat/messages、
   * 且组合表里有同名启用组合时返回该组合。MVP 不在 responses/gemini 上启用组合（responses 留 Phase 2）。
   * 运行时「组合优先」于裸模型名（建组合时已拒绝与模型同名，故正常不冲突）。
   */
  private matchCombo(input: HandleRequestInput): RouteCombo | undefined {
    const { intent } = input
    if (this.combos === undefined) return undefined
    // 组合作用于 chat/messages/responses；gemini generateContent 暂不支持组合。
    if (intent.action !== 'chat' && intent.action !== 'messages' && intent.action !== 'responses') {
      return undefined
    }
    if (intent.model === undefined) return undefined
    // ① 显式组合前缀 cb/<name>：用户明确要组合 → 永远按组合路由（即使带中转注入固定 key，
    //    也优先于直连真实上游）。这是「中转注入 + 号小管作供应商」同名碰撞时选组合的唯一入口。
    if (intent.model.startsWith(COMBO_MODEL_PREFIX)) {
      const name = intent.model.slice(COMBO_MODEL_PREFIX.length)
      const combo = this.combos.findByName(name)
      return combo !== undefined && combo.enabled ? combo : undefined
    }
    // ② 裸名：中转注入固定 key 来源 → 一律直连真实上游(native→登录账号)、跳过组合
    //    （用「来源 key」而非「协议」区分——越来越多 agent 也用 responses，协议不可靠）。
    if (input.injectionOrigin === true) return undefined
    // ③ 裸名 + 普通来源：组合优先（盖过同名上游模型）。
    if (intent.platform !== undefined) return undefined
    const combo = this.combos.findByName(intent.model)
    return combo !== undefined && combo.enabled ? combo : undefined
  }

  /**
   * 组合编排：按链顺序逐跳 dispatch，复用单跳的账号池故障转移（内层）+ 首字节前 peek 回退语义。
   * 某跳成功即返回；可回退错误（429/5xx/无可用账号/无上游等）跌落下一跳；客户端错误(400/422)立即抛。
   * 全链失败抛最后一个错误（由 hono onError 渲染）。同一个 obs 贯穿全链 → 一请求一条 G3 日志。
   */
  private async dispatchCombo(
    combo: RouteCombo,
    input: HandleRequestInput,
    obs: RequestObservation,
  ): Promise<HandleResult> {
    const allSteps = enabledStepModels(combo)
    if (allSteps.length === 0) {
      throw new ApiProxyHttpError(503, `combo "${combo.name}" has no enabled steps`, input.intent.format)
    }
    // Phase 2 配额感知跳过：剔除「确凿不可用」的跳（如 kiro 池内无 available 账号，且非超额服务中），
    // 避免对必失败的上游做无谓往返。但若全部看起来不可用，则保留全链交由反应式回退兜底（健康可能滞后）。
    let steps = allSteps
    if (this.isPlatformExhausted !== undefined) {
      const exhausted = await Promise.all(
        allSteps.map(async (m) => {
          const { platform } = resolveModelAlias(m, this.resolveAlias)
          return platform !== undefined ? this.isPlatformExhausted!(platform) : false
        }),
      )
      const live = allSteps.filter((_, i) => !exhausted[i])
      if (live.length > 0) steps = live
    }
    return runComboChain(steps, (stepModel) =>
      this.dispatch(this.synthesizeStepInput(input, stepModel), obs),
    )
  }

  /**
   * 把组合的一跳 `<别名>/<模型>` 合成为一次普通请求输入：解析别名 → 锁 platform、净化 model，
   * 并把 body.model 改写为该跳真实模型（toIR 对 openai/anthropic 直接读 body.model）。
   * 沿用原请求的 format/action/stream（组合在客户端命中的同一协议入口下逐跳执行）。
   */
  private synthesizeStepInput(input: HandleRequestInput, stepModel: string): HandleRequestInput {
    const { platform, model } = resolveModelAlias(stepModel, this.resolveAlias)
    const realModel = model ?? stepModel
    const intent: RequestIntent = {
      format: input.intent.format,
      action: input.intent.action,
      stream: input.intent.stream,
      ...(platform !== undefined ? { platform } : {}),
      model: realModel,
    }
    const body =
      input.body !== null && typeof input.body === 'object'
        ? { ...(input.body as Record<string, unknown>), model: realModel }
        : input.body
    return { ...input, intent, body }
  }

  /**
   * 单请求编排实体：入站归一化 → 选上游适配器 → chat/chatStream → 出站序列化。
   * 错误统一抛 ApiProxyHttpError（由 hono onError 按 format 渲染错误体）。
   * obs 在链路中被 FailoverAdapter 回填账号/尝试次数，并在此记录 input/output tokens。
   */
  private async dispatch(input: HandleRequestInput, obs: RequestObservation): Promise<HandleResult> {
    const { intent, body, requestId, signal } = input

    if (intent.action === 'health') {
      return { kind: 'json', status: 200, body: { ok: true } }
    }
    if (intent.action === 'models') {
      return { kind: 'json', status: 200, body: this.buildModelsBody(intent) }
    }

    // Responses 协议有专属编排（历史链 + store 落盘 + 语义 SSE），走独立分支，
    // 不复用下方 chat 类的 toIR/toResponseBody/serializeStream。
    if (intent.format === 'openai-responses') {
      // 原生（ChatGPT 登录账号）模型：HTTP 级原始透传到 ChatGPT 后端，不转 IR、不动 store。
      if (this.codexNative !== undefined && this.codexNative.isNativeModel(intent.model)) {
        return this.proxyCodexNative(body, requestId, intent.stream, signal, input.headers)
      }
      // 第三方 responses 上游：HTTP 级透传到对应第三方端点（alias→real 映射 + Bearer 替换）。
      if (intent.model !== undefined) {
        for (const pt of this.responsesPassthroughs) {
          if (pt.supportsModel(intent.model)) {
            return this.proxyResponsesPassthrough(pt, body, requestId, intent.stream, signal, input.headers)
          }
        }
      }
      return this.handleResponses(intent, body, requestId, obs, signal, input.headers, input.clientKeyId)
    }

    if (this.registry === undefined) {
      throw new ApiProxyHttpError(503, 'platform registry not configured', intent.format)
    }

    // 入站 → IR。
    const ir = this.toIR(intent, body)
    obs.inputTokens = estimateRequestInputTokens(ir)
    // 选上游。
    let adapter
    try {
      adapter = this.registry.selectAdapter(intent)
    } catch (e) {
      if (e instanceof NoUpstreamError) {
        throw new ApiProxyHttpError(404, e.message, intent.format)
      }
      throw e
    }

    const sessionHint = extractSessionHint(input.headers ?? {}, body, input.clientKeyId)
    const ctx: UpstreamCtx = {
      ...(signal ? { signal } : {}),
      requestId,
      observation: obs,
      ...(sessionHint !== undefined ? { sessionHint } : {}),
    }

    if (intent.stream) {
      const it = adapter.chatStream(ir, ctx)[Symbol.asyncIterator]()
      let first: IteratorResult<CanonicalStreamEvent>
      try { first = await it.next() } catch (e) { throw classifyToHttp(e, intent.format) }
      const events = prependFirst(first, it)
      return this.serializeStreamLazy(intent, ir, events, requestId)
    }
    let resp
    try { resp = await adapter.chat(ir, ctx) }
    catch (e) { throw classifyToHttp(e, intent.format) }
    if (resp.usage) obs.outputTokens = resp.usage.outputTokens
    return { kind: 'json', status: 200, body: this.toResponseBody(intent, resp, requestId) }
  }

  /**
   * Responses 专属编排：previous_response_id 历史链重建 → responsesToIR → 选上游 →
   * chat/chatStream → irToResponsesResponse / serializeResponsesStream，并按 store 落盘。
   * id/itemId 由 responsesStore 生成（隔离随机/时钟）；落盘失败不阻断响应。
   * headers/clientKeyId 用于注入 sessionHint，使 Responses 路径也具备会话粘性。
   */
  private async handleResponses(
    intent: RequestIntent,
    body: unknown,
    requestId: string,
    obs: RequestObservation,
    signal?: AbortSignal,
    headers?: Record<string, string>,
    clientKeyId?: string,
  ): Promise<HandleResult> {
    if (this.registry === undefined) {
      throw new ApiProxyHttpError(503, 'platform registry not configured', 'openai-responses')
    }
    if (this.responsesStore === undefined) {
      throw new ApiProxyHttpError(503, 'responses store not configured', 'openai-responses')
    }
    const req = (body ?? {}) as ResponsesRequest

    const historyMessages = req.previous_response_id
      ? expandPreviousResponseHistory(req.previous_response_id, (id) => this.responsesStore!.load(id))
      : undefined
    const ir = responsesToIR(req, { ...(historyMessages ? { historyMessages } : {}) })
    // custom(freeform)工具名集合：响应序列化据此把 function_call 还原成 custom_tool_call（apply_patch 等）。
    const customToolNames = responsesCustomToolNames(req)
    obs.inputTokens = estimateRequestInputTokens(ir)

    let adapter
    try {
      adapter = this.registry.selectAdapter(intent)
    } catch (e) {
      if (e instanceof NoUpstreamError) {
        throw new ApiProxyHttpError(404, e.message, 'openai-responses')
      }
      throw e
    }
    const sessionHint = extractSessionHint(headers ?? {}, body, clientKeyId)
    const ctx: UpstreamCtx = {
      ...(signal ? { signal } : {}),
      requestId,
      observation: obs,
      ...(sessionHint !== undefined ? { sessionHint } : {}),
    }
    const respId = this.responsesStore.generateResponseId()
    const itemId = (i: number): string => this.responsesStore!.generateItemId(i)

    if (intent.stream) {
      // 真流式：短宽限期 peek 首事件 —— 快速失败(鉴权/限流/模型不存在,通常 <Grace)→ 正常 HTTP 错误码；
      // 慢但正常(reasoning 长 TTFT)→ 不阻塞，立即开流（created 不再等整段，避免客户端首事件超时断连）。
      const upstream = adapter.chatStream(ir, ctx)[Symbol.asyncIterator]()
      const firstP = upstream.next()
      const GRACE = Symbol('grace')
      let graceTimer: ReturnType<typeof setTimeout> | undefined
      const graceP = new Promise<typeof GRACE>((resolve) => { graceTimer = setTimeout(() => resolve(GRACE), RESPONSES_FIRST_EVENT_GRACE_MS) })
      let raced: { ok: IteratorResult<CanonicalStreamEvent> } | { err: unknown } | typeof GRACE
      try {
        raced = await Promise.race([firstP.then((r) => ({ ok: r }), (e) => ({ err: e })), graceP])
      } finally {
        if (graceTimer !== undefined) clearTimeout(graceTimer)
      }
      if (raced !== GRACE && 'err' in raced) {
        if (typeof upstream.return === 'function') { try { await upstream.return() } catch { /* ignore */ } }
        throw classifyToHttp(raced.err, 'openai-responses')
      }
      const self = this
      return {
        kind: 'stream',
        status: 200,
        contentType: 'text/event-stream',
        frames: serializeResponsesStream(prependFirstFromPromise(firstP, upstream), {
          id: respId,
          itemId,
          createdAt: 0,
          model: ir.model,
          heartbeatMs: RESPONSES_STREAM_HEARTBEAT_MS,
          customToolNames,
          // 仅成功收尾才折叠落盘（store/历史链）；上游中途出错 → 序列化器以 response.failed 收尾、不回调此处。
          onComplete: (events) => {
            const resp = foldStreamForStore(events, ir.model)
            if (resp.usage) obs.outputTokens = resp.usage.outputTokens
            self.persistResponses(req, respId, resp, itemId, customToolNames)
          },
        }),
      }
    }
    let resp
    try { resp = await adapter.chat(ir, ctx) }
    catch (e) { throw classifyToHttp(e, 'openai-responses') }
    if (resp.usage) obs.outputTokens = resp.usage.outputTokens
    this.persistResponses(req, respId, resp, itemId, customToolNames)
    return {
      kind: 'json',
      status: 200,
      body: irToResponsesResponse(resp, {
        id: respId,
        itemId,
        createdAt: 0,
        ...(customToolNames.size > 0 ? { customToolNames } : {}),
        ...(req.previous_response_id ? { previousResponseId: req.previous_response_id } : {}),
      }),
    }
  }

  /**
   * 原生透传：把 Responses 请求原样转发到 ChatGPT 后端（OAuth），SSE 帧不缓冲回吐。
   * 不转 IR、不动 responsesStore —— ChatGPT 后端自管 store/previous_response_id。
   * 错误按来源映射 HTTP：无登录→401、上游 RelayHttpError→透传其状态、其余→502。
   */
  private async proxyCodexNative(
    body: unknown,
    requestId: string,
    stream: boolean,
    signal?: AbortSignal,
    headers?: Record<string, string>,
  ): Promise<HandleResult> {
    if (this.codexNative === undefined) {
      throw new ApiProxyHttpError(503, 'codex-native passthrough not configured', 'openai-responses')
    }
    try {
      const result = await this.codexNative.proxyResponses({
        body,
        requestId,
        stream,
        ...(signal ? { signal } : {}),
        ...(headers ? { headers } : {}),
      })
      if (result.stream !== undefined) {
        return { kind: 'stream', status: result.status, contentType: 'text/event-stream', frames: result.stream }
      }
      return { kind: 'json', status: result.status, body: result.body }
    } catch (e) {
      throw classifyCodexNativeError(e)
    }
  }

  /**
   * responses 第三方透传：把 Responses 请求原样转发到第三方上游（alias→real 映射 + Bearer 替换），
   * SSE 帧不缓冲回吐。不转 IR、不动 responsesStore。
   * 错误按来源映射 HTTP（RelayHttpError→透传状态、其余→502）。
   */
  private async proxyResponsesPassthrough(
    pt: ResponsesPassthroughUpstream,
    body: unknown,
    requestId: string,
    stream: boolean,
    signal?: AbortSignal,
    headers?: Record<string, string>,
  ): Promise<HandleResult> {
    try {
      const result = await pt.proxyResponses({
        body,
        requestId,
        stream,
        ...(signal ? { signal } : {}),
        ...(headers ? { headers } : {}),
      })
      if (result.stream !== undefined) {
        return { kind: 'stream', status: result.status, contentType: 'text/event-stream', frames: result.stream }
      }
      return { kind: 'json', status: result.status, body: result.body }
    } catch (e) {
      throw classifyCodexNativeError(e)
    }
  }

  /** 按 store 标志落盘一条响应（store===false 显式跳过）；I/O 失败吞掉，不影响已生成的响应体。 */
  private persistResponses(
    req: ResponsesRequest,
    id: string,
    resp: CanonicalResponse,
    itemId: (i: number) => string,
    customToolNames?: Set<string>,
  ): void {
    if (req.store === false || this.responsesStore === undefined) return
    const obj = irToResponsesResponse(resp, {
      id,
      itemId,
      createdAt: 0,
      ...(customToolNames && customToolNames.size > 0 ? { customToolNames } : {}),
      ...(req.previous_response_id ? { previousResponseId: req.previous_response_id } : {}),
    })
    const doc: StoredResponseDoc = {
      id,
      createdAt: 0,
      status: 'completed',
      model: resp.model,
      output: obj.output,
      usage: obj.usage,
      ...(req.previous_response_id ? { previousResponseId: req.previous_response_id } : {}),
      ...(req.instructions ? { instructions: req.instructions } : {}),
      storedInput: req.input,
      storedAt: Math.floor(Date.now() / 1000),
    }
    try {
      this.responsesStore.save(doc)
    } catch {
      /* 落盘失败不阻断响应 */
    }
  }

  // ---- 内部：入站 IR ----
  private toIR(intent: RequestIntent, body: unknown): CanonicalRequest {
    switch (intent.format) {
      case 'openai':
        return this.converters.openai.toIR(body as Parameters<typeof openaiToIR>[0])
      case 'anthropic':
        return this.converters.anthropic.toIR(body as Parameters<typeof anthropicToIR>[0])
      case 'gemini': {
        const model = intent.model
        if (model === undefined) {
          throw new ApiProxyHttpError(400, 'gemini request missing model in path', 'gemini')
        }
        return this.converters.gemini.toIR(body as Parameters<typeof geminiToIR>[0], model)
      }
      case 'openai-responses':
        // 不可达：handleRequest 已在上游把 openai-responses 分流到 handleResponses。
        // 保留分支仅为 switch 穷尽（RequestFormat 含此值），命中即编排不变量被破坏。
        throw new ApiProxyHttpError(500, 'unreachable: openai-responses handled by handleResponses', 'openai-responses')
    }
  }

  // ---- 内部：出站非流式 ----
  private toResponseBody(intent: RequestIntent, resp: CanonicalResponse, requestId: string): unknown {
    switch (intent.format) {
      case 'openai':
        return this.converters.openai.toResponse(resp, { id: `chatcmpl-${requestId}`, created: 0 })
      case 'anthropic':
        return this.converters.anthropic.toResponse(resp, { id: `msg_${requestId}` })
      case 'gemini':
        return this.converters.gemini.toResponse(resp)
      case 'openai-responses':
        // 不可达：openai-responses 走 handleResponses，不进 chat 类出站序列化（见上 toIR 注释）。
        throw new ApiProxyHttpError(500, 'unreachable: openai-responses handled by handleResponses', 'openai-responses')
    }
  }

  // ---- 内部：出站流式（惰性版）----
  // OpenAI/Anthropic 真增量逐 token 透传；Gemini 保持 drain 后包装成 AsyncIterable。
  // requestId 用于派生确定性出站 id，禁 Date.now/随机，保证可单测。
  private serializeStreamLazy(
    intent: RequestIntent,
    ir: CanonicalRequest,
    events: AsyncIterable<CanonicalStreamEvent>,
    requestId: string,
  ): StreamResult {
    switch (intent.format) {
      case 'openai':
        return {
          kind: 'stream',
          status: 200,
          contentType: 'text/event-stream',
          frames: serializeOpenAIStreamLazy(events, ir.model, { id: `chatcmpl-${requestId}`, created: 0 }),
        }
      case 'anthropic':
        return {
          kind: 'stream',
          status: 200,
          contentType: 'text/event-stream',
          // message_start input 用请求文本估算（惰性下流末 cache 字段省略，非流式不受影响）。
          frames: serializeAnthropicStreamLazy(events, { model: ir.model, inputTokens: estimateRequestInputTokens(ir) }, { id: `msg_${requestId}` }),
        }
      case 'gemini': {
        // Gemini 保持 drain（非 SSE、一次性 JSON chunk）。
        const self = this
        return {
          kind: 'stream',
          status: 200,
          contentType: 'application/json',
          frames: (async function* () {
            const drained = await drainStream(events)
            yield* self.converters.gemini.serializeStream(drained)
          })(),
        }
      }
      case 'openai-responses':
        // 不可达：openai-responses 走 handleResponses 的 serializeResponsesStream（见上 toIR 注释）。
        throw new ApiProxyHttpError(500, 'unreachable: openai-responses handled by handleResponses', 'openai-responses')
    }
  }

  // ---- 内部：组装一条请求日志记录（G3）----
  private buildRecord(
    input: HandleRequestInput,
    obs: RequestObservation,
    status: number,
    stream: boolean,
    durationMs: number,
    ok: boolean,
    errorMessage?: string,
  ): ProxyRequestRecordInput {
    const { intent } = input
    return {
      method: input.method ?? (intent.action === 'models' ? 'GET' : 'POST'),
      path: input.path ?? '',
      format: intent.format,
      ...(intent.platform !== undefined ? { platform: intent.platform } : {}),
      action: intent.action,
      stream,
      status,
      ok,
      durationMs,
      attempts: obs.attempts,
      ...(obs.accountId !== undefined ? { accountId: obs.accountId } : {}),
      ...(input.clientKeyId !== undefined ? { clientKeyId: input.clientKeyId } : {}),
      ...(obs.inputTokens !== undefined ? { inputTokens: obs.inputTokens } : {}),
      ...(obs.outputTokens !== undefined ? { outputTokens: obs.outputTokens } : {}),
      ...(errorMessage !== undefined ? { errorMessage } : {}),
    }
  }

  // ---- 内部：models 列表体（按 format 形状）----
  private buildModelsBody(intent: RequestIntent): unknown {
    // 有别名的平台（kr/cx）给模型 id 加前缀 → 客户端可直接复制「可路由名」`kr/claude-...`；
    // 无别名平台（relay-<id>/echo）保持裸名（按模型名感知路由）。
    const entries = this.registry ? this.registry.listAllModelsWithPlatform(intent.platform) : []
    const models = entries.map(({ platform, model }) => {
      const alias = PLATFORM_NAME_TO_ALIAS.get(platform)
      return alias !== undefined ? { ...model, id: `${alias}/${model.id}` } : model
    })
    if (intent.format === 'gemini') {
      // Gemini: { models: [{ name, displayName, inputTokenLimit?, outputTokenLimit?, supportedGenerationMethods }] }
      return {
        models: models.map((m) => ({
          name: `models/${m.id}`,
          displayName: m.displayName ?? m.id,
          ...(m.contextLength !== undefined ? { inputTokenLimit: m.contextLength } : {}),
          ...(m.maxOutputTokens !== undefined ? { outputTokenLimit: m.maxOutputTokens } : {}),
          supportedGenerationMethods: ['generateContent', 'streamGenerateContent'],
        })),
      }
    }
    // OpenAI/Anthropic: { object:'list', data:[{ id, object:'model', owned_by, context_length?, capabilities }] }
    // 能力字段（尤其 capabilities.thinking）让客户端据此决定是否发送 thinking 参数（G8）。
    // 路由组合作为 owned_by:'combo' 的虚拟模型排在最前（仅未按平台限定时；客户端可直接把组合名当 model）。
    const comboData =
      intent.platform === undefined && this.combos !== undefined
        ? this.combos
            .list()
            .filter((c) => c.enabled)
            .map((c) => ({
              // 用显式可路由名 cb/<name>：任何场景(含中转注入)都能寻址、不与同名上游模型歧义。
              id: `${COMBO_MODEL_PREFIX}${c.name}`,
              object: 'model',
              created: 0,
              owned_by: 'combo',
              ...(c.description ? { description: c.description } : {}),
              capabilities: {},
            }))
        : []
    return {
      object: 'list',
      data: [
        ...comboData,
        ...models.map((m) => ({
          id: m.id,
          object: 'model',
          created: 0,
          owned_by: m.ownedBy ?? 'kiro',
          ...(m.contextLength !== undefined ? { context_length: m.contextLength } : {}),
          ...(m.maxOutputTokens !== undefined ? { max_output_tokens: m.maxOutputTokens } : {}),
          capabilities: {
            ...(m.supportsThinking !== undefined ? { thinking: m.supportsThinking } : {}),
            ...(m.supportsPromptCaching !== undefined ? { prompt_caching: m.supportsPromptCaching } : {}),
          },
        })),
      ],
    }
  }
}

/**
 * 把流式事件折叠回一个 CanonicalResponse —— 仅供 Responses 落盘（store）与 SSE 头部
 * 的 model/usage 种子用。文本拼接、tool_use 入参 JSON 累积后解析；usage/stopReason 取末值。
 */
function foldStreamForStore(events: CanonicalStreamEvent[], model: string): CanonicalResponse {
  const content: ContentBlock[] = []
  let text = ''
  const tools = new Map<number, { id: string; name: string; json: string }>()
  let usage: CanonicalResponse['usage'] = { inputTokens: 0, outputTokens: 0 }
  let stopReason: CanonicalResponse['stopReason'] = 'end_turn'
  for (const ev of events) {
    if (ev.type === 'text_delta') text += ev.text
    else if (ev.type === 'tool_use_start') tools.set(ev.index, { id: ev.id, name: ev.name, json: '' })
    else if (ev.type === 'tool_use_delta') {
      const t = tools.get(ev.index)
      if (t) t.json += ev.partialJson
    } else if (ev.type === 'usage') usage = ev.usage
    else if (ev.type === 'message_stop') stopReason = ev.stopReason
  }
  if (text) content.push({ type: 'text', text })
  for (const t of tools.values()) {
    let input: Record<string, unknown> = {}
    try {
      const p = JSON.parse(t.json || '{}')
      if (p && typeof p === 'object') input = p as Record<string, unknown>
    } catch {
      input = {}
    }
    content.push({ type: 'tool_use', id: t.id, name: t.name, input })
  }
  return { model, content, stopReason, usage }
}
