import type { ApiHttpServer } from '../infrastructure/http/api-http-server'
import type { PlatformRegistry } from '../infrastructure/platform-registry'
import { NoUpstreamError } from '../infrastructure/platform-registry'
import type { RequestIntent, RequestFormat } from '../domain/request-intent'
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
} from '../infrastructure/inbound/openai'
import {
  anthropicToIR,
  irToAnthropicResponse,
  serializeAnthropicStream,
} from '../infrastructure/inbound/anthropic'
import {
  geminiToIR,
  irToGeminiResponse,
  serializeGeminiStream,
} from '../infrastructure/inbound/gemini'
import { responsesToIR } from '../infrastructure/inbound/responses/responses-input'
import { irToResponsesResponse } from '../infrastructure/inbound/responses/responses-response'
import { serializeResponsesStream } from '../infrastructure/inbound/responses/responses-stream'
import { expandPreviousResponseHistory } from '../infrastructure/responses-store/responses-history'
import type { ResponsesStore, StoredResponseDoc } from '../infrastructure/responses-store/responses-store'
import type { ResponsesRequest } from '../infrastructure/inbound/responses/responses-types'
import type { ContentBlock } from '../domain/canonical'
import type { ApiProxyStatus } from '../../../../shared/api-types'

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
}

// 非流式 / 错误结果：直接作为 JSON 响应体。
export interface JsonResult {
  kind: 'json'
  status: number
  body: unknown
}

// 流式结果：已序列化的 wire 帧数组 + content-type；由 hono handler 写出。
export interface StreamResult {
  kind: 'stream'
  status: number
  frames: string[]
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

// 把异步事件流收集成数组（M2b 简化：先 drain 再一次性序列化；增量透传留 M3）。
async function drainStream(
  stream: AsyncIterable<CanonicalStreamEvent>,
): Promise<CanonicalStreamEvent[]> {
  const events: CanonicalStreamEvent[] = []
  for await (const ev of stream) events.push(ev)
  return events
}

// apiProxy 上下文的 application 服务。包装 ApiHttpServer 提供 start/stop + 状态投影（M1），
// 并编排单请求链路 handleRequest（M2b）。语义对标 contexts/websocket/application/websocket-service.ts。
export class ApiProxyService {
  private readonly registry?: PlatformRegistry
  private readonly converters: InboundConverters
  // Responses 有状态持久化（previous_response_id 历史链 + store 落盘）；仅 /v1/responses 用。
  private readonly responsesStore?: ResponsesStore
  // server 可后置注入（解循环依赖：container 先建 service 再建 listener+server，最后 attachServer）。
  // M1 单参构造 new ApiProxyService(server) 仍合法——server 既可构造传入也可 attach。
  private server?: ApiHttpServer

  constructor(
    server?: ApiHttpServer,
    deps: { registry?: PlatformRegistry; converters?: InboundConverters; responsesStore?: ResponsesStore } = {},
  ) {
    this.server = server
    this.registry = deps.registry
    this.converters = deps.converters ?? DEFAULT_INBOUND_CONVERTERS
    this.responsesStore = deps.responsesStore
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
  }

  async stop(): Promise<void> {
    // server 未 attach 时 stop 是安全 no-op（语义同「本就未启动」）。
    if (!this.server) return
    await this.server.stop()
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
   * 编排单个 API 请求：入站归一化 → 选上游适配器 → chat/chatStream → 出站序列化。
   * 错误统一抛 ApiProxyHttpError（由 hono onError 按 format 渲染错误体）。
   */
  async handleRequest(input: HandleRequestInput): Promise<HandleResult> {
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
      return this.handleResponses(intent, body, requestId, signal, input.headers, input.clientKeyId)
    }

    if (this.registry === undefined) {
      throw new ApiProxyHttpError(503, 'platform registry not configured', intent.format)
    }

    // 入站 → IR。
    const ir = this.toIR(intent, body)
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
      ...(sessionHint !== undefined ? { sessionHint } : {}),
    }

    if (intent.stream) {
      let events
      try { events = await drainStream(adapter.chatStream(ir, ctx)) }
      catch (e) { throw classifyToHttp(e, intent.format) }
      return this.serializeStream(intent, ir, events, requestId)
    }
    let resp
    try { resp = await adapter.chat(ir, ctx) }
    catch (e) { throw classifyToHttp(e, intent.format) }
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
      ...(sessionHint !== undefined ? { sessionHint } : {}),
    }
    const respId = this.responsesStore.generateResponseId()
    const itemId = (i: number): string => this.responsesStore!.generateItemId(i)

    if (intent.stream) {
      let events
      try { events = await drainStream(adapter.chatStream(ir, ctx)) }
      catch (e) { throw classifyToHttp(e, 'openai-responses') }
      const resp = foldStreamForStore(events, ir.model)
      this.persistResponses(req, respId, resp, itemId)
      return {
        kind: 'stream',
        status: 200,
        contentType: 'text/event-stream',
        frames: serializeResponsesStream(resp, events, { id: respId, itemId, createdAt: 0 }),
      }
    }
    let resp
    try { resp = await adapter.chat(ir, ctx) }
    catch (e) { throw classifyToHttp(e, 'openai-responses') }
    this.persistResponses(req, respId, resp, itemId)
    return {
      kind: 'json',
      status: 200,
      body: irToResponsesResponse(resp, {
        id: respId,
        itemId,
        createdAt: 0,
        ...(req.previous_response_id ? { previousResponseId: req.previous_response_id } : {}),
      }),
    }
  }

  /** 按 store 标志落盘一条响应（store===false 显式跳过）；I/O 失败吞掉，不影响已生成的响应体。 */
  private persistResponses(
    req: ResponsesRequest,
    id: string,
    resp: CanonicalResponse,
    itemId: (i: number) => string,
  ): void {
    if (req.store === false || this.responsesStore === undefined) return
    const obj = irToResponsesResponse(resp, {
      id,
      itemId,
      createdAt: 0,
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

  // ---- 内部：出站流式 ----
  // requestId 用于派生确定性出站 id（与非流式 toResponseBody 对齐：chatcmpl-${requestId}/msg_${requestId}），
  // 仍禁 Date.now/随机，保证可单测。
  private serializeStream(
    intent: RequestIntent,
    ir: CanonicalRequest,
    events: CanonicalStreamEvent[],
    requestId: string,
  ): StreamResult {
    switch (intent.format) {
      case 'openai':
        return {
          kind: 'stream',
          status: 200,
          contentType: 'text/event-stream',
          frames: this.converters.openai.serializeStream(events, ir.model, { id: `chatcmpl-${requestId}`, created: 0 }),
        }
      case 'anthropic': {
        // Anthropic 流需要一个 resp 提供 message_start 的初始 usage/model；从 events 里抽 usage，缺省 0。
        const usageEvent = events.find((e): e is { type: 'usage'; usage: CanonicalResponse['usage'] } => e.type === 'usage')
        const seed: CanonicalResponse = {
          model: ir.model,
          content: [],
          stopReason: 'end_turn',
          usage: usageEvent ? usageEvent.usage : { inputTokens: 0, outputTokens: 0 },
        }
        return {
          kind: 'stream',
          status: 200,
          contentType: 'text/event-stream',
          frames: this.converters.anthropic.serializeStream(seed, events, { id: `msg_${requestId}` }),
        }
      }
      case 'gemini':
        return {
          kind: 'stream',
          status: 200,
          contentType: 'application/json',
          frames: this.converters.gemini.serializeStream(events),
        }
      case 'openai-responses':
        // 不可达：openai-responses 走 handleResponses 的 serializeResponsesStream（见上 toIR 注释）。
        throw new ApiProxyHttpError(500, 'unreachable: openai-responses handled by handleResponses', 'openai-responses')
    }
  }

  // ---- 内部：models 列表体（按 format 形状）----
  private buildModelsBody(intent: RequestIntent): unknown {
    const models = this.registry ? this.registry.listAllModels(intent.platform) : []
    if (intent.format === 'gemini') {
      // Gemini: { models: [{ name: 'models/<id>' }] }
      return { models: models.map((m) => ({ name: `models/${m.id}`, displayName: m.displayName ?? m.id })) }
    }
    // OpenAI/Anthropic: { object:'list', data:[{ id, object:'model' }] }
    return { object: 'list', data: models.map((m) => ({ id: m.id, object: 'model' })) }
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
