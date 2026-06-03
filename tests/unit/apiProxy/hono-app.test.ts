import { describe, it, expect } from 'vitest'
import { createHonoApp, type HonoAppDeps } from '../../../src/main/contexts/apiProxy/infrastructure/http/hono-app'
import { ApiHttpServer } from '../../../src/main/contexts/apiProxy/infrastructure/http/api-http-server'
import { ApiProxyService } from '../../../src/main/contexts/apiProxy/application/api-proxy-service'
import { PlatformRegistry } from '../../../src/main/contexts/apiProxy/infrastructure/platform-registry'
import { EchoUpstreamAdapter } from '../../../src/main/contexts/apiProxy/infrastructure/adapters/echo/echo-adapter'

// M5: 测试环境 Hono app.request() 无真实 TCP socket，remote 为 undefined → isLoopback=false。
// 为避免每个非鉴权测试都带 Bearer，默认用 'test-key' + 请求带固定头；鉴权专项测试单独配置。
const TEST_KEY = 'test-key'
const AUTH_HEADERS = { authorization: `Bearer ${TEST_KEY}` }

function makeDeps(authKeys: readonly string[] = [TEST_KEY]): HonoAppDeps {
  const registry = new PlatformRegistry()
  registry.register(new EchoUpstreamAdapter())
  // 方案 B：server 可后置 attach；这里直接构造传入占位 server（hono app 不用它，只 service.start/stop 才需要）。
  const service = new ApiProxyService(new ApiHttpServer(() => {}, { port: 0 }), { registry })
  return {
    service,
    auth: { keysProvider: async () => authKeys, allowAnonymousLoopback: true },
    knownPlatforms: registry.knownPlatforms(),
  }
}

describe('createHonoApp', () => {
  // ---- M1 既有断言（保留，不回归）----
  it('GET /health returns 200 and { ok: true }', async () => {
    const app = createHonoApp(makeDeps())
    const res = await app.request('/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('unknown route returns 404', async () => {
    const app = createHonoApp(makeDeps())
    const res = await app.request('/does-not-exist', { headers: AUTH_HEADERS })
    expect(res.status).toBe(404)
  })

  // ---- M2b 新增：鉴权 + 三协议 + models ----
  it('OpenAI chat over /v1/chat/completions echoes through Echo', async () => {
    const app = createHonoApp(makeDeps())
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...AUTH_HEADERS },
      body: JSON.stringify({ model: 'echo-1', messages: [{ role: 'user', content: 'hi' }] }),
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { choices: { message: { content: string } }[] }
    expect(json.choices[0].message.content).toBe('hi')
  })

  it('Anthropic messages over /v1/messages', async () => {
    const app = createHonoApp(makeDeps())
    const res = await app.request('/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...AUTH_HEADERS },
      body: JSON.stringify({ model: 'echo-1', max_tokens: 8, messages: [{ role: 'user', content: 'yo' }] }),
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { content: { type: string; text: string }[] }
    expect(json.content[0]).toEqual({ type: 'text', text: 'yo' })
  })

  it('Gemini generateContent over /v1beta/models/echo-1:generateContent', async () => {
    const app = createHonoApp(makeDeps())
    const res = await app.request('/v1beta/models/echo-1:generateContent', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...AUTH_HEADERS },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'g' }] }] }),
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { candidates: { content: { parts: { text: string }[] } }[] }
    expect(json.candidates[0].content.parts[0].text).toBe('g')
  })

  it('platform-locked /echo/v1/chat/completions works; unknown platform → 404', async () => {
    const app = createHonoApp(makeDeps())
    const ok = await app.request('/echo/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...AUTH_HEADERS },
      body: JSON.stringify({ model: 'echo-1', messages: [{ role: 'user', content: 'p' }] }),
    })
    expect(ok.status).toBe(200)
    const miss = await app.request('/nope/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...AUTH_HEADERS },
      body: JSON.stringify({ model: 'echo-1', messages: [] }),
    })
    expect(miss.status).toBe(404)
  })

  it('GET /v1/models lists echo models', async () => {
    const app = createHonoApp(makeDeps())
    const res = await app.request('/v1/models', { headers: AUTH_HEADERS })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { data: { id: string }[] }
    expect(json.data.map((m) => m.id)).toEqual(['echo-1', 'echo-mini'])
  })

  it('GET /v1beta/models returns gemini-shaped model list', async () => {
    const app = createHonoApp(makeDeps())
    const res = await app.request('/v1beta/models', { headers: AUTH_HEADERS })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { models: { name: string }[] }
    expect(json.models.map((m) => m.name)).toEqual(['models/echo-1', 'models/echo-mini'])
  })

  it('GET /echo/v1/models scopes to the echo platform', async () => {
    const app = createHonoApp(makeDeps())
    const res = await app.request('/echo/v1/models', { headers: AUTH_HEADERS })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { data: { id: string }[] }
    expect(json.data.map((m) => m.id)).toEqual(['echo-1', 'echo-mini'])
  })

  it('no configured keys + loopback (allowAnonymousLoopback=true) → 200 from /health (exempt)', async () => {
    // /health は常に豁免、keysProvider 関係なし
    const app = createHonoApp(makeDeps([]))
    const res = await app.request('/health')
    expect(res.status).toBe(200)
  })

  it('auth: configured keys reject missing key with 401', async () => {
    const app = createHonoApp(makeDeps(['secret']))
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'echo-1', messages: [] }),
    })
    expect(res.status).toBe(401)
  })

  it('auth: configured keys accept matching Bearer', async () => {
    const app = createHonoApp(makeDeps(['secret']))
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer secret' },
      body: JSON.stringify({ model: 'echo-1', messages: [{ role: 'user', content: 'ok' }] }),
    })
    expect(res.status).toBe(200)
  })
})
