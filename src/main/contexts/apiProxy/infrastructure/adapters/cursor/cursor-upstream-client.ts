// CursorUpstreamClient：cursor StreamUnifiedChatWithTools 调用的传输层。
// 职责：① 组 protobuf 二进制 body（generateCursorBody）+ Connect-RPC 鉴权头（buildCursorHeaders）；
// ② 经统一出站 transport（undici + ambient dispatcher，读 currentDispatcher）POST；
// ③ 401/403 调一次 refresher 后重试；④ 整包 bytes → foldCursorResponse / streamCursorResponse。
// 代理出站不在此层：CursorAdapter 用 runWithDispatcher 包住调用。
import { Agent, fetch as undiciFetch } from 'undici'
import { currentDispatcher } from '../../../../../platform/net/dispatcher-context'
import { generateCursorBody } from './cursor-protobuf'
import { buildCursorHeaders } from './cursor-checksum'
import { foldCursorResponse, streamCursorResponse, type CursorUpstreamFault } from './cursor-response'
import {
  CursorUpstreamError,
  CursorUpstreamAuthError,
  CursorTokenPermanentError,
  CursorRateLimitError,
} from './cursor-error'
import type { CursorRequestShape } from './cursor-request-mapper'
import type { KiroTokenRefresher } from '../kiro/kiro-ports'
import type { CanonicalRequest, CanonicalResponse, CanonicalStreamEvent } from '../../../domain/canonical'

const BASE_URL = 'https://api2.cursor.sh'
const CHAT_PATH = '/aiserver.v1.ChatService/StreamUnifiedChatWithTools'
const HTTP_TIMEOUT_MS = 120_000

// api2.cursor.sh 走 AWS ALB 的 gRPC/HTTP2 目标组：HTTP/1.1 请求会被拒 464（协议版本不兼容）。
// 故 cursor 出站必须 HTTP/2。undici Agent allowH2 开启 h2；直连用此 Agent，有账号代理时用注入 dispatcher
// （注意：代理 dispatcher 也需支持 h2，否则代理路径同样 464——待 proxyResolver 侧支持后生效）。
const cursorH2Agent = new Agent({ allowH2: true })

async function defaultCursorFetch(url: string, init: RequestInit): Promise<Response> {
  const dispatcher = currentDispatcher() ?? cursorH2Agent
  return (await undiciFetch(url, {
    ...(init as unknown as Parameters<typeof undiciFetch>[1]),
    dispatcher,
  })) as unknown as Response
}

/** 一次调用的路由/凭据上下文（由 CursorAdapter.prepare 从 ctx 组装）。 */
export interface CursorCallContext {
  accessToken: string
  refreshToken?: string
  /** storage.json telemetry.machineId（64 位 sha256，cursor checksum 真实用值）；缺失走 SHA256 兜底。 */
  machineId?: string
  /** storage.json telemetry.macMachineId；macOS 真实客户端 checksum 后缀 `${machineId}/${macMachineId}`。 */
  macMachineId?: string
  /** 客户端版本（product.json version）；缺省用 cursor-checksum 内置最近值。 */
  clientVersion?: string
  ghostMode?: boolean
  signal?: AbortSignal
}

/** 非确定性来源注入（默认真实值，测试注入固定值）。checksum 本质依赖真实时钟。 */
export interface CursorClientDeps {
  now?: () => number
  /** messageId / conversationId 生成（protobuf body）。 */
  genId?: () => string
  /** x-request-id / x-amzn-trace-id / x-cursor-config-version 生成（headers）。 */
  genUuid?: () => string
}

export type CursorFetchImpl = (url: string, init: RequestInit) => Promise<Response>

export interface CursorUpstreamClientOpts {
  fetchImpl?: CursorFetchImpl
  refresher: KiroTokenRefresher
  deps?: CursorClientDeps
}

export class CursorUpstreamClient {
  private readonly fetchImpl: CursorFetchImpl
  private readonly refresher: KiroTokenRefresher
  private readonly deps: CursorClientDeps

  constructor(opts: CursorUpstreamClientOpts) {
    this.fetchImpl = opts.fetchImpl ?? defaultCursorFetch
    this.refresher = opts.refresher
    this.deps = opts.deps ?? {}
  }

  private buildBody(shape: CursorRequestShape, cursorModelId: string): Uint8Array {
    return generateCursorBody(shape.messages, cursorModelId, shape.tools, shape.reasoningEffort, false, {
      ...(this.deps.genId !== undefined ? { genId: this.deps.genId } : {}),
      ...(this.deps.now !== undefined ? { now: this.deps.now } : {}),
    })
  }

  private buildHeaders(ctx: CursorCallContext): Record<string, string> {
    return buildCursorHeaders(ctx.accessToken, ctx.machineId ?? null, ctx.ghostMode ?? true, {
      ...(this.deps.now !== undefined ? { now: this.deps.now } : {}),
      ...(this.deps.genUuid !== undefined ? { genUuid: this.deps.genUuid } : {}),
      ...(ctx.macMachineId !== undefined ? { macMachineId: ctx.macMachineId } : {}),
      ...(ctx.clientVersion !== undefined ? { clientVersion: ctx.clientVersion } : {}),
    })
  }

  /** 非流式：整包 → CanonicalResponse。 */
  async chat(
    shape: CursorRequestShape,
    cursorModelId: string,
    ctx: CursorCallContext,
    model: string,
    request: CanonicalRequest,
  ): Promise<CanonicalResponse> {
    const bytes = await this.send(shape, cursorModelId, ctx)
    const { response, fault } = foldCursorResponse(bytes, model, request)
    if (fault) throw faultToError(fault)
    return response!
  }

  /** 流式（缓冲式）：整包 → CanonicalStreamEvent 序列。 */
  async *chatStream(
    shape: CursorRequestShape,
    cursorModelId: string,
    ctx: CursorCallContext,
    model: string,
    request: CanonicalRequest,
  ): AsyncIterable<CanonicalStreamEvent> {
    const bytes = await this.send(shape, cursorModelId, ctx)
    const { events, fault } = streamCursorResponse(bytes, model, request)
    if (fault) throw faultToError(fault)
    for (const ev of events!) yield ev
  }

  /** 发送 + 401/403 单次刷新重试 → 返回响应全量字节。 */
  private async send(shape: CursorRequestShape, cursorModelId: string, ctx: CursorCallContext): Promise<Uint8Array> {
    const body = this.buildBody(shape, cursorModelId)
    let curCtx = ctx
    let refreshed = false

    for (let attempt = 0; attempt < 2; attempt++) {
      const headers = this.buildHeaders(curCtx)
      const resp = await this.doFetch(BASE_URL + CHAT_PATH, headers, body, curCtx.signal)

      if (resp.status === 200) {
        return new Uint8Array(await resp.arrayBuffer())
      }

      const text = await safeText(resp)

      if (resp.status === 429) throw new CursorRateLimitError(`cursor rate limited (429): ${text.slice(0, 200)}`, 429)
      if (resp.status === 402) throw new CursorUpstreamError(`cursor quota exhausted (402): ${text.slice(0, 200)}`, 402)

      if (resp.status === 401 || resp.status === 403) {
        if (!refreshed) {
          const outcome = await this.refresher.refresh(
            { token: curCtx.accessToken, ...(curCtx.refreshToken !== undefined ? { refreshToken: curCtx.refreshToken } : {}) },
            '',
          )
          if (outcome.kind === 'refreshed') {
            refreshed = true
            curCtx = {
              ...curCtx,
              accessToken: outcome.token,
              ...(outcome.refreshToken !== undefined ? { refreshToken: outcome.refreshToken } : {}),
            }
            continue
          }
          if (outcome.kind === 'permanent') {
            throw new CursorTokenPermanentError(`cursor token permanently invalid (${resp.status})`, resp.status)
          }
          // transient：当作临时服务端错误，冷却切号稍后重试，不移池。
          throw new CursorUpstreamError(`cursor auth refresh transient failure (${resp.status})`, resp.status)
        }
        throw new CursorUpstreamAuthError(`cursor auth error ${resp.status}: ${text.slice(0, 200)}`, resp.status)
      }

      throw new CursorUpstreamError(`cursor upstream error ${resp.status}: ${text.slice(0, 200)}`, resp.status)
    }

    throw new CursorUpstreamError('cursor request failed after refresh retry', 502)
  }

  private async doFetch(
    url: string,
    headers: Record<string, string>,
    body: Uint8Array,
    signal?: AbortSignal,
  ): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS)
    const onAbort = (): void => controller.abort()
    if (signal !== undefined) {
      if (signal.aborted) controller.abort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }
    try {
      // body 为 protobuf 二进制帧（Uint8Array）；undici fetch 接受，cast 避开非全局的 BodyInit 名。
      const init = { method: 'POST', headers, body, signal: controller.signal } as unknown as RequestInit
      return await this.fetchImpl(url, init)
    } finally {
      clearTimeout(timer)
      if (signal !== undefined) signal.removeEventListener('abort', onAbort)
    }
  }
}

function faultToError(fault: CursorUpstreamFault): Error {
  if (fault.rateLimited) return new CursorRateLimitError(fault.message, 429)
  // cursor 用 HTTP 200 + protobuf unauthenticated 表达 token 失效 → 映射 AUTH（切号），非 FATAL。
  if (fault.unauthenticated) return new CursorUpstreamAuthError(fault.message, 401)
  return new CursorUpstreamError(fault.message, 400)
}

async function safeText(resp: Response): Promise<string> {
  try {
    return await resp.text()
  } catch {
    return ''
  }
}
