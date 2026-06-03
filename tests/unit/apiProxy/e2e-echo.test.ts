// 端到端测试（M2b Task 9）：起真实 ApiHttpServer（绑 port 0 取 OS 分配端口）+ 真实
// createApiRequestListener(deps)，用全局 fetch 打真实 HTTP，覆盖三协议 × 两入口经 Echo
// 跑通（含一条流式 + 鉴权矩阵）。这是「单测过 ≠ 能启动」之前最接近真机的一层（不需 Electron）。
//
// 装配链路：PlatformRegistry(+EchoUpstreamAdapter) → ApiProxyService → createApiRequestListener
//          → new ApiHttpServer(listener, { port: 0 }) → start() 拿真实端口 → fetch。
// 解循环依赖用 plan Task 9 给定的 Proxy 转发：service 先持一个 Proxy 占位 server，
// 待 ApiHttpServer 实例化后回填 ref.current，Proxy 再把方法转发到真实 server。
//
// 断言策略：非流式断响应体回显；流式断 SSE content-type + 回显文本 + 收尾 [DONE]。
// afterEach 务必 server.stop()，避免端口泄漏。
import { describe, it, expect, afterEach } from 'vitest'
import { ApiHttpServer } from '../../../src/main/contexts/apiProxy/infrastructure/http/api-http-server'
import { createApiRequestListener, type HonoAppDeps } from '../../../src/main/contexts/apiProxy/infrastructure/http/hono-app'
import { ApiProxyService } from '../../../src/main/contexts/apiProxy/application/api-proxy-service'
import { PlatformRegistry } from '../../../src/main/contexts/apiProxy/infrastructure/platform-registry'
import { EchoUpstreamAdapter } from '../../../src/main/contexts/apiProxy/infrastructure/adapters/echo/echo-adapter'

let server: ApiHttpServer | null = null

// 构造完整装配：registry(+Echo) + service + listener + ApiHttpServer(port 0)。
// authKeys 注入鉴权配置；allowAnon 控制 allowAnonymousLoopback（默认 true，对齐 plan 主用例）。
function buildServer(
  authKeys: string[] = [],
  allowAnon = true,
): { server: ApiHttpServer; start: () => Promise<number> } {
  const registry = new PlatformRegistry()
  registry.register(new EchoUpstreamAdapter())
  const ref: { current: ApiHttpServer | null } = { current: null }
  const service = new ApiProxyService(
    new Proxy({} as ApiHttpServer, {
      get(_t, prop) {
        const s = ref.current
        if (!s) throw new Error('not initialized')
        // @ts-expect-error 动态转发：把对占位 server 的属性/方法访问透明转给真实 server。
        const v = s[prop]
        return typeof v === 'function' ? v.bind(s) : v
      },
    }),
    { registry },
  )
  const deps: HonoAppDeps = {
    service,
    auth: { keysProvider: async () => authKeys, allowAnonymousLoopback: allowAnon },
    knownPlatforms: registry.knownPlatforms(),
  }
  const s = new ApiHttpServer(createApiRequestListener(deps), { port: 0 })
  ref.current = s
  server = s
  return { server: s, start: () => s.start() }
}

afterEach(async () => {
  if (server) {
    await server.stop()
    server = null
  }
})

describe('e2e: Echo over real HTTP', () => {
  it('OpenAI non-stream — bare /v1/chat/completions', async () => {
    const { start } = buildServer()
    const port = await start()
    const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'echo-1', messages: [{ role: 'user', content: 'e2e-openai' }] }),
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { choices: { message: { content: string } }[] }
    expect(json.choices[0].message.content).toBe('e2e-openai')
  })

  it('Anthropic non-stream — platform-locked /echo/v1/messages', async () => {
    const { start } = buildServer()
    const port = await start()
    const res = await fetch(`http://127.0.0.1:${port}/echo/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'echo-1', max_tokens: 8, messages: [{ role: 'user', content: 'e2e-anthropic' }] }),
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { content: { type: string; text: string }[] }
    expect(json.content[0]).toEqual({ type: 'text', text: 'e2e-anthropic' })
  })

  it('Gemini non-stream — bare /v1beta/models/echo-1:generateContent', async () => {
    const { start } = buildServer()
    const port = await start()
    const res = await fetch(`http://127.0.0.1:${port}/v1beta/models/echo-1:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'e2e-gemini' }] }] }),
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { candidates: { content: { parts: { text: string }[] } }[] }
    expect(json.candidates[0].content.parts[0].text).toBe('e2e-gemini')
  })

  it('Gemini non-stream — platform-locked /echo/v1beta/models/echo-1:generateContent', async () => {
    const { start } = buildServer()
    const port = await start()
    const res = await fetch(`http://127.0.0.1:${port}/echo/v1beta/models/echo-1:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'e2e-gem2' }] }] }),
    })
    expect(res.status).toBe(200)
  })

  it('OpenAI STREAM — /v1/chat/completions with stream:true delivers SSE then [DONE]', async () => {
    const { start } = buildServer()
    const port = await start()
    const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'echo-1', stream: true, messages: [{ role: 'user', content: 'streamed-e2e' }] }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const text = await res.text()
    expect(text).toContain('"streamed-e2e"')
    expect(text.trimEnd().endsWith('data: [DONE]')).toBe(true)
  })

  it('Gemini STREAM — :streamGenerateContent keeps application/json content-type (not text/event-stream)', async () => {
    // 回归护栏：Gemini 流式是非 SSE 协议（帧体为 JSON chunk），hono streamSSE 会无条件把
    // Content-Type 改成 text/event-stream，故 handler 必须改走保留头的非 SSE 写法。
    // 断言响应头是 application/json（不是 text/event-stream）+ 帧体含 echo 回显。
    const { start } = buildServer()
    const port = await start()
    const res = await fetch(`http://127.0.0.1:${port}/v1beta/models/echo-1:streamGenerateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'streamed-gemini' }] }] }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(res.headers.get('content-type')).not.toContain('text/event-stream')
    const text = await res.text()
    expect(text).toContain('"streamed-gemini"')
  })

  it('Anthropic non-stream — bare /v1/messages (second entry for anthropic)', async () => {
    const { start } = buildServer()
    const port = await start()
    const res = await fetch(`http://127.0.0.1:${port}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'echo-1', max_tokens: 8, messages: [{ role: 'user', content: 'bare-anthropic' }] }),
    })
    expect(res.status).toBe(200)
  })

  it('OpenAI non-stream — platform-locked /echo/v1/chat/completions (second entry for openai)', async () => {
    const { start } = buildServer()
    const port = await start()
    const res = await fetch(`http://127.0.0.1:${port}/echo/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'echo-1', messages: [{ role: 'user', content: 'locked-openai' }] }),
    })
    expect(res.status).toBe(200)
  })

  it('health works over HTTP without a key', async () => {
    const { start } = buildServer(['some-key'])
    const port = await start()
    const res = await fetch(`http://127.0.0.1:${port}/health`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  // ---- 鉴权矩阵（task 显式要求）：配 apiProxyClientKeys 后无 Key 应拒、带正确 Key 放行 ----

  it('AUTH — configured key + missing key → 401（allowAnonymousLoopback:false 确保 loopback 也拒）', async () => {
    // keys 非空 + 没带 key：allowAnonymousLoopback=false → 即使 loopback 也拒（reason:'missing' → 401）。
    const { start } = buildServer(['secret-key'], false)
    const port = await start()
    const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'echo-1', messages: [{ role: 'user', content: 'no-key' }] }),
    })
    expect(res.status).toBe(401)
    // 裸 OpenAI 路径 → 错误体走 openai 形状。
    const json = (await res.json()) as { error: { type: string } }
    expect(json.error.type).toBe('authentication_error')
  })

  it('AUTH — configured key + wrong key → 401', async () => {
    // keys 非空但提供的 Bearer 不匹配 → reason:'invalid' → 同样 401。
    const { start } = buildServer(['secret-key'])
    const port = await start()
    const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer wrong-key' },
      body: JSON.stringify({ model: 'echo-1', messages: [{ role: 'user', content: 'bad-key' }] }),
    })
    expect(res.status).toBe(401)
  })

  it('AUTH — configured key + correct Bearer key → 200 and echoes', async () => {
    // 提供匹配的 Bearer key → 放行 → 正常回显。
    const { start } = buildServer(['secret-key'])
    const port = await start()
    const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer secret-key' },
      body: JSON.stringify({ model: 'echo-1', messages: [{ role: 'user', content: 'good-key' }] }),
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { choices: { message: { content: string } }[] }
    expect(json.choices[0].message.content).toBe('good-key')
  })

  it('AUTH — configured key + correct x-api-key header → 200 (anthropic entry)', async () => {
    // Anthropic 客户端惯用 x-api-key；extractClientKey 优先级覆盖该来源。
    const { start } = buildServer(['secret-key'])
    const port = await start()
    const res = await fetch(`http://127.0.0.1:${port}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'secret-key' },
      body: JSON.stringify({ model: 'echo-1', max_tokens: 8, messages: [{ role: 'user', content: 'via-x-api-key' }] }),
    })
    expect(res.status).toBe(200)
  })

  it('AUTH — configured key + correct ?key= query (gemini entry) → 200', async () => {
    // Gemini 客户端惯用 ?key=；extractClientKey 优先级覆盖查询参数来源。
    const { start } = buildServer(['secret-key'])
    const port = await start()
    const res = await fetch(`http://127.0.0.1:${port}/v1beta/models/echo-1:generateContent?key=secret-key`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'via-query-key' }] }] }),
    })
    expect(res.status).toBe(200)
  })

  // ---- allowAnonymousLoopback 行为各一例（M2b 语义：keys 为空 → 始终放行，与该标志无关）----

  it('ANON — empty keys + allowAnonymousLoopback:true → loopback request allowed (200)', async () => {
    const { start } = buildServer([], true)
    const port = await start()
    const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'echo-1', messages: [{ role: 'user', content: 'anon-on' }] }),
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { choices: { message: { content: string } }[] }
    expect(json.choices[0].message.content).toBe('anon-on')
  })

  it('ANON — empty keys + allowAnonymousLoopback:false → 401（M5 护栏激活：loopback 豁免关闭）', async () => {
    // M5 语义：keys 为空且 allowAnonymousLoopback=false → 即使来自 loopback 也拒（missing）。
    const { start } = buildServer([], false)
    const port = await start()
    const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'echo-1', messages: [{ role: 'user', content: 'anon-off' }] }),
    })
    expect(res.status).toBe(401)
  })
})
