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
  type ClientKeyRequestInfo,
} from '../../domain/client-key-auth'

// Hono app 依赖：编排服务 + 鉴权配置 + 已注册平台名（喂路由意图解析的前缀剥离）。
export interface HonoAppDeps {
  service: ApiProxyService
  auth: { keysProvider: () => Promise<readonly string[]>; allowAnonymousLoopback: boolean }
  knownPlatforms: ReadonlySet<string>
}

// 远端地址是否回环。@hono/node-server 把底层 socket 暴露在 c.env.incoming（node IncomingMessage）。
function isLoopbackRemote(remote: string | undefined): boolean {
  if (!remote) return false
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
}

/** 仅 /health 与 /{platform}/health 豁免鉴权（收紧 M2b 的 endsWith 过宽）。 */
export function isHealthExempt(path: string): boolean {
  return path === '/health' || /^\/[^/]+\/health$/.test(path)
}

// 组装 Hono app：中间件链 + 路由表 + onError。M1 的 GET /health 行为保持（200 { ok: true }）。
export function createHonoApp(deps: HonoAppDeps): Hono<{ Variables: HonoVariables }> {
  const app = new Hono<{ Variables: HonoVariables }>()
  const parseIntent = makeRequestIntentParser(deps.knownPlatforms)

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

  // 鉴权中间件：/health 豁免；其余按客户端 Key 规则。
  app.use('*', async (c, next) => {
    if (isHealthExempt(c.req.path)) return next()
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
    const keys = await deps.auth.keysProvider()
    const decision = authorizeClientKey(info, { keys, allowAnonymousLoopback: deps.auth.allowAnonymousLoopback })
    if (!decision.ok) {
      // 鉴权失败：missing/invalid 一律 401（M2b 不区分；安全护栏留 M5）。
      return c.json(errorBodyForFormat(formatFromPath(c.req.path), 401, 'Invalid or missing API key'), 401)
    }
    if (decision.keyId !== undefined) {
      c.set('apiProxyClientKeyId', decision.keyId)
    }
    return next()
  })

  // 统一业务 handler：解析意图 → service.handleRequest → 写出。
  const handle = async (c: Context) => {
    const method = c.req.method
    const path = c.req.path
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
    // 稳定 requestId：从已有 header 取，缺省用确定性占位（适配器据此派生出站 id，不读时钟/随机）。
    const requestId = c.req.header('x-request-id') ?? 'apiproxy'
    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries(c.req.header())) headers[k.toLowerCase()] = v
    const clientKeyId = c.get('apiProxyClientKeyId')
    const result = await deps.service.handleRequest({
      intent,
      body,
      requestId,
      headers,
      ...(clientKeyId ? { clientKeyId } : {}),
      // AbortSignal 透传：node 适配层在断连时 abort（M2b 可选，省略亦可）。
    })
    if (result.kind === 'json') {
      return c.json(result.body as object, result.status as 200)
    }
    // 流式按协议分流：SSE 协议（OpenAI/Anthropic，text/event-stream）用 streamSSE 逐 frame
    // 裸写（frame 已是完整 wire 文本，用 stream.write 而非 writeSSE 以免二次包裹）。
    // 注意：hono streamSSE 内部无条件把 Content-Type 设为 text/event-stream，故非 SSE 协议
    // （Gemini，application/json）不能走 streamSSE——否则 result.contentType 会被覆盖。
    if (result.contentType === 'text/event-stream') {
      return streamSSE(c, async (stream) => {
        for (const frame of result.frames) {
          await stream.write(frame)
        }
      })
    }
    // 非 SSE 流式（Gemini）：拼帧一次性写出，并显式保留 result.contentType（application/json），
    // 不经 streamSSE 以免头被改写。frame 已是完整 wire 文本，直接 join 即得响应体。
    return c.body(result.frames.join(''), result.status as 200, { 'Content-Type': result.contentType })
  }

  // 路由表（裸 + /{platform} 前缀；用 all 收口让 parseIntent 决定合法性）。
  // /health 保持 M1 行为（200 { ok: true }），不经 handle/service。
  app.get('/health', (c) => c.json({ ok: true }))
  app.all('/v1/chat/completions', handle)
  app.all('/v1/messages', handle)
  app.all('/v1/responses', handle)
  app.all('/v1/models', handle)
  app.all('/v1beta/models', handle)
  app.all('/v1beta/models/:tail', handle)
  app.all('/:platform/v1/chat/completions', handle)
  app.all('/:platform/v1/messages', handle)
  app.all('/:platform/v1/responses', handle)
  app.all('/:platform/v1/models', handle)
  app.all('/:platform/v1beta/models', handle)
  app.all('/:platform/v1beta/models/:tail', handle)
  app.all('/:platform/health', handle)

  // 统一错误体：ApiProxyHttpError 用其携带 status/format；其余 500。
  app.onError((err, c) => {
    if (err instanceof ApiProxyHttpError) {
      return c.json(errorBodyForFormat(err.format, err.status, err.message), err.status as 400)
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
