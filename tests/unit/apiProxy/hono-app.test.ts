import { describe, it, expect } from 'vitest'
import { createHonoApp, type HonoAppDeps } from '../../../src/main/contexts/apiProxy/infrastructure/http/hono-app'
import { ApiHttpServer } from '../../../src/main/contexts/apiProxy/infrastructure/http/api-http-server'
import { ApiProxyService } from '../../../src/main/contexts/apiProxy/application/api-proxy-service'
import { PlatformRegistry } from '../../../src/main/contexts/apiProxy/infrastructure/platform-registry'
import { EchoUpstreamAdapter } from '../../../src/main/contexts/apiProxy/infrastructure/adapters/echo/echo-adapter'

function makeDeps(authKeys: readonly string[] = []): HonoAppDeps {
  const registry = new PlatformRegistry()
  registry.register(new EchoUpstreamAdapter())
  // 方案 B：server 可后置 attach；这里直接构造传入占位 server（hono app 不用它，只 service.start/stop 才需要）。
  const service = new ApiProxyService(new ApiHttpServer(() => {}, { port: 0 }), { registry })
  return {
    service,
    auth: { keys: authKeys, allowAnonymousLoopback: true },
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
    const res = await app.request('/does-not-exist')
    expect(res.status).toBe(404)
  })

  // ---- M2b 新增：鉴权 + 三协议 + models ----
  it('OpenAI chat over /v1/chat/completions echoes through Echo', async () => {
    const app = createHonoApp(makeDeps())
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
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
      headers: { 'content-type': 'application/json' },
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
      headers: { 'content-type': 'application/json' },
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
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'echo-1', messages: [{ role: 'user', content: 'p' }] }),
    })
    expect(ok.status).toBe(200)
    const miss = await app.request('/nope/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'echo-1', messages: [] }),
    })
    expect(miss.status).toBe(404)
  })

  it('GET /v1/models lists echo models', async () => {
    const app = createHonoApp(makeDeps())
    const res = await app.request('/v1/models')
    expect(res.status).toBe(200)
    const json = (await res.json()) as { data: { id: string }[] }
    expect(json.data.map((m) => m.id)).toEqual(['echo-1', 'echo-mini'])
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
