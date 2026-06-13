import type { IncomingMessage, ServerResponse } from 'node:http'
import { Hono } from 'hono'
import type { Context } from 'hono'
import { cors } from 'hono/cors'
import { streamSSE } from 'hono/streaming'
import { getRequestListener } from '@hono/node-server'
import type { ApiProxyService } from '../../application/api-proxy-service'
import { ApiProxyHttpError } from '../../application/api-proxy-service'
import { makeRequestIntentParser } from '../../domain/request-intent'
import type { RequestFormat } from '../../domain/request-intent'
import {
  authorizeClientKey,
  extractClientKey,
  type ClientKeyRequestInfo,
} from '../../domain/client-key-auth'
import type { KeyRateLimiter } from '../../domain/key-rate-limiter'
import { redactString } from '../../../../platform/log/redact'
import { isIpAllowed } from '../../domain/ip-access-control'

// Hono app 依赖：编排服务 + 鉴权配置 + 模型别名解析器（把 model 前缀段解析为平台名）。
export interface HonoAppDeps {
  service: ApiProxyService
  auth: { keysProvider: () => Promise<readonly string[]>; allowAnonymousLoopback: boolean }
  /** 把 model 前缀段（如 `kr`/`relay-<id>`）解析为已注册平台名；非别名返回 undefined。喂路由意图解析。 */
  resolvePlatformAlias: (prefix: string) => string | undefined
  /** 可选：客户端 Key 令牌桶限流器；不传则不限流（向后兼容）。匿名回环请求（无 keyId）自动跳过。 */
  keyRateLimiter?: KeyRateLimiter
  /** 可选：Prometheus /metrics 文本渲染（G10）；不传则 /metrics 返回 404。 */
  metrics?: () => Promise<string>
  /** 可选：IP CIDR 白/黑名单（G5），闭包读 settings 实时值；不传或皆空=不限制。 */
  ipAccess?: () => { allowlist: string; denylist: string }
  /** 可选：请求体大小上限字节（G6），闭包读 settings；返回 0 或不传=不限制。 */
  maxBodyBytes?: () => number
  /**
   * 可选：中转注入固定 key（隐藏、仅本地）。带此 key 的请求标记为「注入来源」→ 直连真实上游、
   * 不走路由组合。不在客户端 Key 列表里、不参与限流；仅 loopback 接受（非本地直接 401）。
   */
  relayInjectionKey?: string
}

// 远端地址是否回环。@hono/node-server 把底层 socket 暴露在 c.env.incoming（node IncomingMessage）。
// 若取不到 remote（某些反代/协议场景），保守当非 loopback，并记 warn 供排查鉴权问题。
function isLoopbackRemote(remote: string | undefined): boolean {
  if (!remote) {
    console.warn(redactString('[apiProxy] remote address unavailable, treating as non-loopback'))
    return false
  }
  const r = remote.startsWith('::ffff:') ? remote.slice(7) : remote
  return r === '127.0.0.1' || r === '::1' || r === 'localhost'
}

// 按入站 format 渲染错误体（对齐各协议错误结构）。
function errorBodyForFormat(format: RequestFormat, status: number, message: string): unknown {
  if (format === 'anthropic') {
    return { type: 'error', error: { type: anthropicErrorType(status), message } }
  }
  if (format === 'gemini') {
    return { error: { code: status, message, status: geminiErrorStatus(status) } }
  }
  // openai
  return { error: { message, type: openaiErrorType(status), code: status } }
}

function anthropicErrorType(status: number): string {
  if (status === 400) return 'invalid_request_error'
  if (status === 401) return 'authentication_error'
  if (status === 403) return 'permission_error'
  if (status === 404) return 'not_found_error'
  if (status === 429) return 'rate_limit_error'
  return 'api_error'
}
function openaiErrorType(status: number): string {
  if (status === 400) return 'invalid_request_error'
  if (status === 401) return 'authentication_error'
  if (status === 404) return 'not_found_error'
  if (status === 429) return 'rate_limit_error'
  return 'api_error'
}
function geminiErrorStatus(status: number): string {
  if (status === 400) return 'INVALID_ARGUMENT'
  if (status === 401) return 'UNAUTHENTICATED'
  if (status === 403) return 'PERMISSION_DENIED'
  if (status === 404) return 'NOT_FOUND'
  if (status === 429) return 'RESOURCE_EXHAUSTED'
  return 'INTERNAL'
}

// 5xx 通用消息（G14）：上游/内部 5xx 一律替换为通用文案，不向客户端泄露内部细节。
function genericServerMessage(status: number): string {
  if (status === 502) return 'Upstream error'
  if (status === 503) return 'Service unavailable'
  if (status === 504) return 'Upstream timeout'
  return 'Internal server error'
}

// 鉴权失败时还没解析 intent，用路径关键字粗判 format（仅决定错误体形状）。
function formatFromPath(path: string): RequestFormat {
  if (path.includes('/messages')) return 'anthropic'
  if (path.includes('/responses')) return 'openai'
  if (path.includes('/v1beta/')) return 'gemini'
  return 'openai'
}

// Hono 应用级变量（c.set/c.get 的类型安全声明）。
type HonoVariables = {
  apiProxyClientKeyId?: string
  /** 中转注入固定 key 命中（loopback）→ 该请求直连真实上游、不走路由组合。 */
  apiProxyInjectionOrigin?: boolean
}

/** 仅裸 /health 豁免鉴权（平台前缀路由已移除，不再有 /{platform}/health）。 */
export function isHealthExempt(path: string): boolean {
  return path === '/health'
}

// 组装 Hono app：中间件链 + 路由表 + onError。M1 的 GET /health 行为保持（200 { ok: true }）。
export function createHonoApp(deps: HonoAppDeps): Hono<{ Variables: HonoVariables }> {
  const app = new Hono<{ Variables: HonoVariables }>()
  const parseIntent = makeRequestIntentParser(deps.resolvePlatformAlias)

  // CORS：放行常见 AI 客户端头（含 anthropic-version / x-api-key / x-goog-api-key）。
  app.use(
    '*',
    cors({
      origin: '*',
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: [
        'Content-Type',
        'Authorization',
        'x-api-key',
        'x-goog-api-key',
        'anthropic-version',
        'anthropic-beta',
      ],
    }),
  )

  // IP 访问控制（G5）：CIDR 白/黑名单，**最外层闸**——先于鉴权且不豁免 /health·/metrics
  // （/metrics 暴露账号计数尤需 IP 闸）。判定取 socket.remoteAddress，不信 X-Forwarded-For。
  if (deps.ipAccess !== undefined) {
    app.use('*', async (c, next) => {
      const { allowlist, denylist } = deps.ipAccess!()
      if (allowlist.trim().length === 0 && denylist.trim().length === 0) return next()
      const remote = (c.env as { incoming?: IncomingMessage } | undefined)?.incoming?.socket?.remoteAddress
      if (!isIpAllowed(remote, allowlist, denylist)) {
        console.warn(redactString(`[apiProxy] IP 拒绝 ${remote ?? 'unknown'} → ${c.req.path}`))
        return c.json(errorBodyForFormat(formatFromPath(c.req.path), 403, 'Forbidden'), 403)
      }
      return next()
    })
  }

  // 鉴权中间件：/health 豁免；其余按客户端 Key 规则。
  app.use('*', async (c, next) => {
    if (isHealthExempt(c.req.path) || c.req.path === '/metrics') return next()
    const remote = (c.env as { incoming?: IncomingMessage } | undefined)?.incoming?.socket?.remoteAddress
    const authorization = c.req.header('authorization')
    const xApiKey = c.req.header('x-api-key')
    const xGoogApiKey = c.req.header('x-goog-api-key')
    const queryKey = c.req.query('key')
    const info: ClientKeyRequestInfo = {
      ...(authorization ? { authorization } : {}),
      ...(xApiKey ? { xApiKey } : {}),
      ...(xGoogApiKey ? { xGoogApiKey } : {}),
      ...(queryKey ? { queryKey } : {}),
      isLoopback: isLoopbackRemote(remote),
    }
    // 中转注入固定 key（不在客户端 Key 列表里、仅本地）：命中即标记注入来源 → 直连真实上游、不走组合。
    if (deps.relayInjectionKey !== undefined && deps.relayInjectionKey.length > 0) {
      const presented = extractClientKey(info)
      if (presented !== undefined && presented === deps.relayInjectionKey) {
        if (!info.isLoopback) {
          // 固定注入 key 仅允许本地访问；非 loopback 一律拒。
          return c.json(errorBodyForFormat(formatFromPath(c.req.path), 401, 'Invalid or missing API key'), 401)
        }
        c.set('apiProxyInjectionOrigin', true)
        return next()
      }
    }
    const keys = await deps.auth.keysProvider()
    const decision = authorizeClientKey(info, { keys, allowAnonymousLoopback: deps.auth.allowAnonymousLoopback })
    if (!decision.ok) {
      // 鉴权失败：missing/invalid 一律 401（M2b 不区分；安全护栏留 M5）。
      return c.json(errorBodyForFormat(formatFromPath(c.req.path), 401, 'Invalid or missing API key'), 401)
    }
    if (decision.keyId !== undefined) {
      c.set('apiProxyClientKeyId', decision.keyId)
      // 令牌桶限流：仅对有 keyId 的已鉴权 key 生效；匿名回环（无 keyId）跳过。
      if (deps.keyRateLimiter !== undefined) {
        const rl = deps.keyRateLimiter.tryAcquire(decision.keyId)
        if (!rl.ok) {
          const path = c.req.path
          c.header('Retry-After', String(rl.retryAfterSec))
          return c.json(errorBodyForFormat(formatFromPath(path), 429, 'Rate limit exceeded'), 429)
        }
      }
    }
    return next()
  })

  // 统一业务 handler：解析意图 → service.handleRequest → 写出。
  const handle = async (c: Context) => {
    const method = c.req.method
    const path = c.req.path
    // 请求体大小上限（G6）：超 Content-Length 即 413，避免全量读入放大内存。
    if (method === 'POST' && deps.maxBodyBytes !== undefined) {
      const max = deps.maxBodyBytes()
      const len = Number(c.req.header('content-length') ?? '')
      if (max > 0 && Number.isFinite(len) && len > max) {
        return c.json(errorBodyForFormat(formatFromPath(path), 413, 'Request body too large'), 413)
      }
    }
    let body: unknown
    if (method === 'POST') {
      try {
        body = await c.req.json()
      } catch {
        body = undefined
      }
    }
    // parseRequestIntent 内部已 split('?')，直接传 c.req.path（不含 query）即可。
    const intent = parseIntent(method, path, body)
    if (intent === null) {
      return c.json(errorBodyForFormat('openai', 404, `Not Found: ${path}`), 404)
    }
    // 别名前缀已在 parseIntent 从 intent.model 剥离；openai/anthropic/responses 出站模型取自 body.model
    // （toIR 直接读 body），故把净化后的真实模型名回写 body，确保上游收到不含别名前缀的模型。
    // gemini 模型在 path（intent.model）里，body 无 model 字段，此处自然 no-op。
    if (
      intent.model !== undefined &&
      body !== null &&
      typeof body === 'object' &&
      typeof (body as Record<string, unknown>).model === 'string'
    ) {
      ;(body as Record<string, unknown>).model = intent.model
    }
    // 稳定 requestId：从已有 header 取，缺省用确定性占位（适配器据此派生出站 id，不读时钟/随机）。
    const requestId = c.req.header('x-request-id') ?? 'apiproxy'
    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries(c.req.header())) headers[k.toLowerCase()] = v
    const clientKeyId = c.get('apiProxyClientKeyId')
    const injectionOrigin = c.get('apiProxyInjectionOrigin') === true
    const result = await deps.service.handleRequest({
      intent,
      body,
      requestId,
      headers,
      method,
      path,
      ...(clientKeyId ? { clientKeyId } : {}),
      ...(injectionOrigin ? { injectionOrigin: true } : {}),
      // AbortSignal 透传：node 适配层在断连时 abort（M2b 可选，省略亦可）。
    })
    if (result.kind === 'json') {
      return c.json(result.body as object, result.status as 200)
    }
    // 流式按协议分流：SSE 协议（OpenAI/Anthropic，text/event-stream）用 streamSSE 逐 frame
    // for-await 裸写（frame 已是完整 wire 文本，用 stream.write 而非 writeSSE 以免二次包裹）。
    // 注意：hono streamSSE 内部无条件把 Content-Type 设为 text/event-stream，故非 SSE 协议
    // （Gemini，application/json）不能走 streamSSE——否则 result.contentType 会被覆盖。
    if (result.contentType === 'text/event-stream') {
      return streamSSE(c, async (stream) => {
        for await (const frame of result.frames) {
          await stream.write(frame)
        }
      })
    }
    // 非 SSE 流式（Gemini）：收集所有帧后拼接一次性写出，保留 result.contentType（application/json），
    // 不经 streamSSE 以免头被改写。frame 已是完整 wire 文本，直接 join 即得响应体。
    const parts: string[] = []
    for await (const frame of result.frames) parts.push(frame)
    return c.body(parts.join(''), result.status as 200, { 'Content-Type': result.contentType })
  }

  // 路由表（仅裸 /v1.. /v1beta..；平台前缀路由已移除，平台由模型名前缀区分）。
  // 用 all 收口让 parseIntent 决定合法性。/health 保持 M1 行为（200 { ok: true }），不经 handle/service。
  app.get('/health', (c) => c.json({ ok: true }))
  // Prometheus /metrics（G10）：免客户端 Key 鉴权（同 /health）。默认仅绑 127.0.0.1，本机可直采；
  // 若绑 0.0.0.0 会暴露账号计数，应配合 G5 CIDR 白名单或上游反代鉴权再开放。
  app.get('/metrics', async (c) => {
    if (deps.metrics === undefined) return c.text('metrics unavailable\n', 404)
    const body = await deps.metrics()
    return c.body(body, 200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' })
  })
  app.all('/v1/chat/completions', handle)
  app.all('/v1/messages', handle)
  app.all('/v1/responses', handle)
  app.all('/v1/models', handle)
  app.all('/v1beta/models', handle)
  app.all('/v1beta/models/:tail', handle)

  // 统一错误体（G14 脱敏）：5xx 强制通用消息（不泄露上游/内部细节）；<500 的消息过 redactString
  // 剥 Bearer/JWT/凭据后再下发。非 ApiProxyHttpError 一律 500 通用消息。
  app.onError((err, c) => {
    if (err instanceof ApiProxyHttpError) {
      const safeMsg = err.status >= 500 ? genericServerMessage(err.status) : redactString(err.message)
      return c.json(errorBodyForFormat(err.format, err.status, safeMsg), err.status as 400)
    }
    return c.json(errorBodyForFormat('openai', 500, 'Internal server error'), 500)
  })

  return app
}

// 把 Hono app 适配成 ApiHttpServer 需要的 node 风格 handler。
// getRequestListener 由 @hono/node-server 提供，将 Web Fetch handler(app.fetch) 转成 (req, res) => void，
// 无需动态 import、与 externalize/CJS 兼容。deps 由 container 注入。
export function createApiRequestListener(
  deps: HonoAppDeps,
): (req: IncomingMessage, res: ServerResponse) => void {
  return getRequestListener(createHonoApp(deps).fetch)
}
