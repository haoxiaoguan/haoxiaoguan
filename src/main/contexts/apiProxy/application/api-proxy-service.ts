import type { ApiHttpServer, ApiHttpServerState } from '../infrastructure/http/api-http-server'
import type { PlatformRegistry } from '../infrastructure/platform-registry'
import { NoUpstreamError } from '../infrastructure/platform-registry'
import type { RequestIntent, RequestFormat } from '../domain/request-intent'
import type { UpstreamCtx } from '../domain/platform-adapter'
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

// 返回给 renderer 的状态投影（spec §13：apiProxy:getStatus → { state, port? }）。
// M1 只含 state + 可选 port；M2+ 再扩 startedAt/accountsHealthy/accountsTotal。
export interface ApiProxyStatus {
  state: ApiHttpServerState
  port?: number
}

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
  // server 可后置注入（解循环依赖：container 先建 service 再建 listener+server，最后 attachServer）。
  // M1 单参构造 new ApiProxyService(server) 仍合法——server 既可构造传入也可 attach。
  private server?: ApiHttpServer

  constructor(
    server?: ApiHttpServer,
    deps: { registry?: PlatformRegistry; converters?: InboundConverters } = {},
  ) {
    this.server = server
    this.registry = deps.registry
    this.converters = deps.converters ?? DEFAULT_INBOUND_CONVERTERS
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

    const ctx: UpstreamCtx = { ...(signal ? { signal } : {}), requestId }

    if (intent.stream) {
      const events = await drainStream(adapter.chatStream(ir, ctx))
      return this.serializeStream(intent, ir, events, requestId)
    }
    const resp = await adapter.chat(ir, ctx)
    return { kind: 'json', status: 200, body: this.toResponseBody(intent, resp, requestId) }
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
