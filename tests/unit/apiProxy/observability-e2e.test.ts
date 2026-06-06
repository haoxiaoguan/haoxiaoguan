// 可观测性地基集成测试（G3 请求日志 / G10 /metrics / G14 错误脱敏）：起真实 ApiHttpServer
// （port 0）+ 真实 hono 管线，用全局 fetch 打真实 HTTP，覆盖三块功能的端到端行为。
import { describe, it, expect, afterEach } from 'vitest'
import { ApiHttpServer } from '../../../src/main/contexts/apiProxy/infrastructure/http/api-http-server'
import { createApiRequestListener, type HonoAppDeps } from '../../../src/main/contexts/apiProxy/infrastructure/http/hono-app'
import { ApiProxyService, ApiProxyHttpError } from '../../../src/main/contexts/apiProxy/application/api-proxy-service'
import { PlatformRegistry } from '../../../src/main/contexts/apiProxy/infrastructure/platform-registry'
import { EchoUpstreamAdapter } from '../../../src/main/contexts/apiProxy/infrastructure/adapters/echo/echo-adapter'
import { ProxyRequestLog } from '../../../src/main/contexts/apiProxy/domain/observability/proxy-request-log'
import { renderPrometheus } from '../../../src/main/contexts/apiProxy/domain/observability/prometheus'

let server: ApiHttpServer | null = null
afterEach(async () => {
  if (server) {
    await server.stop()
    server = null
  }
})

// Echo + observability 的真实装配（含 /metrics 闭包，账号 gauge 留 0 — Echo 无账号池）。
function buildEchoServer(log: ProxyRequestLog, authKeys: string[] = [], allowAnon = true): ApiHttpServer {
  const registry = new PlatformRegistry()
  registry.register(new EchoUpstreamAdapter())
  const ref: { current: ApiHttpServer | null } = { current: null }
  const service = new ApiProxyService(
    new Proxy({} as ApiHttpServer, {
      get(_t, prop) {
        const s = ref.current
        if (!s) throw new Error('not initialized')
        // @ts-expect-error 动态转发占位 server → 真实 server。
        const v = s[prop]
        return typeof v === 'function' ? v.bind(s) : v
      },
    }),
    { registry, observability: log },
  )
  const metrics = async (): Promise<string> =>
    renderPrometheus({
      counters: log.counters(),
      uptimeSeconds: 0,
      inflight: 0,
      accountStates: { available: 0, cooldown: 0, quota_exhausted: 0, suspended: 0 },
    })
  const deps: HonoAppDeps = {
    service,
    auth: { keysProvider: async () => authKeys, allowAnonymousLoopback: allowAnon },
    knownPlatforms: registry.knownPlatforms(),
    metrics,
  }
  const s = new ApiHttpServer(createApiRequestListener(deps), { port: 0 })
  ref.current = s
  server = s
  return s
}

// 仅用于 G14：service 是抛 ApiProxyHttpError 的桩，验证 hono onError 脱敏。
function buildStubServer(throwErr: () => never): ApiHttpServer {
  const service = { handleRequest: async () => throwErr() } as unknown as ApiProxyService
  const deps: HonoAppDeps = {
    service,
    auth: { keysProvider: async () => [], allowAnonymousLoopback: true },
    knownPlatforms: new Set<string>(),
  }
  const s = new ApiHttpServer(createApiRequestListener(deps), { port: 0 })
  server = s
  return s
}

async function postChat(port: number, content: string): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'echo-1', messages: [{ role: 'user', content }] }),
  })
}

describe('G3 请求级日志', () => {
  it('成功请求记录一条日志（method/path/format/status/inputTokens）', async () => {
    const log = new ProxyRequestLog({ clock: () => 1000 })
    const port = await buildEchoServer(log).start()
    const res = await postChat(port, 'hello-observability')
    expect(res.status).toBe(200)
    const recent = log.listRecent()
    expect(recent).toHaveLength(1)
    expect(recent[0]).toMatchObject({
      method: 'POST',
      path: '/v1/chat/completions',
      format: 'openai',
      action: 'chat',
      status: 200,
      ok: true,
      stream: false,
    })
    expect(recent[0].inputTokens).toBeGreaterThan(0)
  })

  it('health / models 不落日志（避免噪声）', async () => {
    const log = new ProxyRequestLog({ clock: () => 0 })
    const port = await buildEchoServer(log).start()
    await fetch(`http://127.0.0.1:${port}/health`)
    await fetch(`http://127.0.0.1:${port}/v1/models`)
    expect(log.listRecent()).toHaveLength(0)
  })
})

describe('G10 /metrics', () => {
  it('返回 prometheus 文本，计数反映已处理请求', async () => {
    const log = new ProxyRequestLog({ clock: () => 0 })
    const port = await buildEchoServer(log).start()
    await postChat(port, 'm1')
    const res = await fetch(`http://127.0.0.1:${port}/metrics`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('version=0.0.4')
    const text = await res.text()
    expect(text).toContain('apiproxy_requests_total 1')
    expect(text).toContain('apiproxy_requests_success_total 1')
    expect(text).toContain('# TYPE apiproxy_uptime_seconds gauge')
    expect(text).toContain('apiproxy_accounts{state="available"} 0')
  })

  it('/metrics 免客户端 Key 鉴权（配置了 Key 时业务端点 401，/metrics 仍 200）', async () => {
    const log = new ProxyRequestLog({ clock: () => 0 })
    const port = await buildEchoServer(log, ['secret-key'], false).start()
    const noKey = await postChat(port, 'm')
    expect(noKey.status).toBe(401)
    const metrics = await fetch(`http://127.0.0.1:${port}/metrics`)
    expect(metrics.status).toBe(200)
  })
})

describe('G14 出站错误体脱敏', () => {
  it('<500 错误消息过 redactString（剥 Bearer token）', async () => {
    const port = await buildStubServer(() => {
      throw new ApiProxyHttpError(400, 'bad request Authorization: Bearer sk-secret-xyz123', 'openai')
    }).start()
    const res = await postChat(port, 'x')
    expect(res.status).toBe(400)
    const json = (await res.json()) as { error: { message: string } }
    expect(json.error.message).toContain('Bearer [REDACTED]')
    expect(json.error.message).not.toContain('sk-secret-xyz123')
  })

  it('5xx 强制通用消息，不泄露上游/内部细节', async () => {
    const port = await buildStubServer(() => {
      throw new ApiProxyHttpError(502, 'upstream /Users/secret/path leaked Bearer sk-zzz', 'openai')
    }).start()
    const res = await postChat(port, 'x')
    expect(res.status).toBe(502)
    const json = (await res.json()) as { error: { message: string } }
    expect(json.error.message).toBe('Upstream error')
    expect(json.error.message).not.toContain('/Users/secret')
    expect(json.error.message).not.toContain('sk-zzz')
  })
})
