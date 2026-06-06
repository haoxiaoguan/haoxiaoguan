// G5 IP 白/黑名单 / G6 请求体上限 413 / G8 /v1/models 能力字段——起真实 ApiHttpServer + hono，
// 用全局 fetch 打真实 HTTP 验证端到端行为。
import { describe, it, expect, afterEach } from 'vitest'
import { ApiHttpServer } from '../../../src/main/contexts/apiProxy/infrastructure/http/api-http-server'
import { createApiRequestListener, type HonoAppDeps } from '../../../src/main/contexts/apiProxy/infrastructure/http/hono-app'
import { ApiProxyService } from '../../../src/main/contexts/apiProxy/application/api-proxy-service'
import { PlatformRegistry } from '../../../src/main/contexts/apiProxy/infrastructure/platform-registry'
import { EchoUpstreamAdapter } from '../../../src/main/contexts/apiProxy/infrastructure/adapters/echo/echo-adapter'
import type { PlatformUpstreamAdapter } from '../../../src/main/contexts/apiProxy/domain/platform-adapter'

let server: ApiHttpServer | null = null
afterEach(async () => {
  if (server) {
    await server.stop()
    server = null
  }
})

interface BuildOpts {
  ipAccess?: { allowlist: string; denylist: string }
  maxBodyBytes?: number
  adapters?: PlatformUpstreamAdapter[]
}

function buildServer(opts: BuildOpts = {}): ApiHttpServer {
  const registry = new PlatformRegistry()
  for (const a of opts.adapters ?? [new EchoUpstreamAdapter()]) registry.register(a)
  const ref: { current: ApiHttpServer | null } = { current: null }
  const service = new ApiProxyService(
    new Proxy({} as ApiHttpServer, {
      get(_t, prop) {
        const s = ref.current
        if (!s) throw new Error('not initialized')
        // @ts-expect-error 动态转发占位 → 真实 server。
        const v = s[prop]
        return typeof v === 'function' ? v.bind(s) : v
      },
    }),
    { registry },
  )
  const deps: HonoAppDeps = {
    service,
    auth: { keysProvider: async () => [], allowAnonymousLoopback: true },
    knownPlatforms: registry.knownPlatforms(),
    ...(opts.ipAccess ? { ipAccess: () => opts.ipAccess! } : {}),
    ...(opts.maxBodyBytes !== undefined ? { maxBodyBytes: () => opts.maxBodyBytes! } : {}),
  }
  const s = new ApiHttpServer(createApiRequestListener(deps), { port: 0 })
  ref.current = s
  server = s
  return s
}

function postChat(port: number, content: string): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'echo-1', messages: [{ role: 'user', content }] }),
  })
}

const LOOPBACK = '127.0.0.1,::1'

describe('G5 IP 访问控制', () => {
  it('空白名单/黑名单 → 放行', async () => {
    const port = await buildServer({ ipAccess: { allowlist: '', denylist: '' } }).start()
    expect((await postChat(port, 'x')).status).toBe(200)
  })

  it('回环在黑名单 → 403', async () => {
    const port = await buildServer({ ipAccess: { allowlist: '', denylist: LOOPBACK } }).start()
    expect((await postChat(port, 'x')).status).toBe(403)
  })

  it('白名单不含回环 → 403；含回环 → 200', async () => {
    const denied = await buildServer({ ipAccess: { allowlist: '10.0.0.0/8', denylist: '' } }).start()
    expect((await postChat(denied, 'x')).status).toBe(403)
    await server!.stop()
    server = null
    const allowed = await buildServer({ ipAccess: { allowlist: LOOPBACK, denylist: '' } }).start()
    expect((await postChat(allowed, 'x')).status).toBe(200)
  })

  it('IP 闸不豁免 /metrics 与 /health（黑名单回环则全拒）', async () => {
    const port = await buildServer({ ipAccess: { allowlist: '', denylist: LOOPBACK } }).start()
    expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(403)
    expect((await fetch(`http://127.0.0.1:${port}/metrics`)).status).toBe(403)
  })
})

describe('G6 请求体大小上限', () => {
  it('超 Content-Length → 413', async () => {
    const port = await buildServer({ maxBodyBytes: 10 }).start()
    const res = await postChat(port, 'this body is definitely larger than ten bytes')
    expect(res.status).toBe(413)
  })

  it('0 = 不限制 → 200', async () => {
    const port = await buildServer({ maxBodyBytes: 0 }).start()
    expect((await postChat(port, 'whatever length body here')).status).toBe(200)
  })

  it('上限充足 → 200', async () => {
    const port = await buildServer({ maxBodyBytes: 1_000_000 }).start()
    expect((await postChat(port, 'small')).status).toBe(200)
  })
})

describe('G8 /v1/models 能力字段', () => {
  const capAdapter: PlatformUpstreamAdapter = {
    platform: 'capx',
    supportsModel: () => true,
    listModels: () => [
      {
        id: 'claude-test',
        displayName: 'Claude Test',
        contextLength: 200_000,
        maxOutputTokens: 64_000,
        supportsThinking: true,
        supportsPromptCaching: true,
        ownedBy: 'anthropic',
      },
    ],
    chat: () => Promise.reject(new Error('n/a')),
    chatStream: () => {
      throw new Error('n/a')
    },
    classifyError: () => 'FATAL',
  }

  it('OpenAI 形状带 owned_by / context_length / capabilities.thinking', async () => {
    const port = await buildServer({ adapters: [capAdapter] }).start()
    const res = await fetch(`http://127.0.0.1:${port}/v1/models`)
    expect(res.status).toBe(200)
    const json = (await res.json()) as { data: Array<Record<string, unknown>> }
    const m = json.data[0]
    expect(m.id).toBe('claude-test')
    expect(m.owned_by).toBe('anthropic')
    expect(m.context_length).toBe(200_000)
    expect(m.max_output_tokens).toBe(64_000)
    expect((m.capabilities as Record<string, unknown>).thinking).toBe(true)
    expect((m.capabilities as Record<string, unknown>).prompt_caching).toBe(true)
  })

  it('Gemini 形状带 inputTokenLimit / outputTokenLimit / supportedGenerationMethods', async () => {
    const port = await buildServer({ adapters: [capAdapter] }).start()
    const res = await fetch(`http://127.0.0.1:${port}/v1beta/models`)
    expect(res.status).toBe(200)
    const json = (await res.json()) as { models: Array<Record<string, unknown>> }
    const m = json.models[0]
    expect(m.name).toBe('models/claude-test')
    expect(m.inputTokenLimit).toBe(200_000)
    expect(m.outputTokenLimit).toBe(64_000)
    expect(m.supportedGenerationMethods).toEqual(['generateContent', 'streamGenerateContent'])
  })
})
