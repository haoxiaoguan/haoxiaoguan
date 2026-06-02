import { describe, it, expect } from 'vitest'
import { ApiHttpServer } from '../../../src/main/contexts/apiProxy/infrastructure/http/api-http-server'
import { ApiProxyService, ApiProxyHttpError } from '../../../src/main/contexts/apiProxy/application/api-proxy-service'
import { PlatformRegistry } from '../../../src/main/contexts/apiProxy/infrastructure/platform-registry'
import { EchoUpstreamAdapter } from '../../../src/main/contexts/apiProxy/infrastructure/adapters/echo/echo-adapter'
import type { RequestIntent } from '../../../src/main/contexts/apiProxy/domain/request-intent'

function makeService(): ApiProxyService {
  const registry = new PlatformRegistry()
  registry.register(new EchoUpstreamAdapter())
  // server 不会被 start，仅满足构造；port 0。
  return new ApiProxyService(new ApiHttpServer(() => {}, { port: 0 }), { registry })
}

const svc = makeService()

describe('handleRequest — health / models', () => {
  it('health → { ok: true }', async () => {
    const r = await svc.handleRequest({ intent: { format: 'openai', action: 'health', stream: false }, body: undefined, requestId: 'r1' })
    expect(r).toEqual({ kind: 'json', status: 200, body: { ok: true } })
  })
  it('openai models → object:list with echo models', async () => {
    const r = await svc.handleRequest({ intent: { format: 'openai', action: 'models', stream: false }, body: undefined, requestId: 'r1' })
    expect(r.kind).toBe('json')
    expect((r as { body: { data: { id: string }[] } }).body.data.map((m) => m.id)).toEqual(['echo-1', 'echo-mini'])
  })
  it('gemini models → { models:[{ name }] }', async () => {
    const r = await svc.handleRequest({ intent: { format: 'gemini', action: 'models', stream: false }, body: undefined, requestId: 'r1' })
    expect((r as { body: { models: { name: string }[] } }).body.models[0].name).toBe('models/echo-1')
  })
})

describe('handleRequest — non-stream chat through Echo', () => {
  it('openai chat echoes the user text', async () => {
    const intent: RequestIntent = { format: 'openai', action: 'chat', model: 'echo-1', stream: false }
    const r = await svc.handleRequest({
      intent,
      body: { model: 'echo-1', messages: [{ role: 'user', content: 'ping' }] },
      requestId: 'abc',
    })
    expect(r.kind).toBe('json')
    const body = (r as { body: { id: string; choices: { message: { content: string } }[] } }).body
    expect(body.id).toBe('chatcmpl-abc')
    expect(body.choices[0].message.content).toBe('ping')
  })
  it('anthropic messages echoes the user text', async () => {
    const intent: RequestIntent = { format: 'anthropic', action: 'messages', model: 'echo-1', stream: false }
    const r = await svc.handleRequest({
      intent,
      body: { model: 'echo-1', max_tokens: 16, messages: [{ role: 'user', content: 'pong' }] },
      requestId: 'xyz',
    })
    const body = (r as { body: { id: string; content: { type: string; text: string }[] } }).body
    expect(body.id).toBe('msg_xyz')
    expect(body.content[0]).toEqual({ type: 'text', text: 'pong' })
  })
  it('gemini generateContent echoes the user text (model from intent)', async () => {
    const intent: RequestIntent = { format: 'gemini', action: 'generateContent', model: 'echo-1', stream: false }
    const r = await svc.handleRequest({
      intent,
      body: { contents: [{ role: 'user', parts: [{ text: 'hey' }] }] },
      requestId: 'g1',
    })
    const body = (r as { body: { candidates: { content: { parts: { text: string }[] } }[] } }).body
    expect(body.candidates[0].content.parts[0].text).toBe('hey')
  })
})

describe('handleRequest — streaming through Echo', () => {
  it('openai stream produces SSE frames ending in [DONE]', async () => {
    const intent: RequestIntent = { format: 'openai', action: 'chat', model: 'echo-1', stream: true }
    const r = await svc.handleRequest({
      intent,
      body: { model: 'echo-1', stream: true, messages: [{ role: 'user', content: 'streamed' }] },
      requestId: 's1',
    })
    expect(r.kind).toBe('stream')
    const frames = (r as { frames: string[]; contentType: string }).frames
    expect((r as { contentType: string }).contentType).toBe('text/event-stream')
    expect(frames.some((f) => f.includes('"streamed"'))).toBe(true)
    expect(frames.at(-1)).toBe('data: [DONE]\n\n')
  })
  it('anthropic stream seeds message_start usage from events', async () => {
    const intent: RequestIntent = { format: 'anthropic', action: 'messages', model: 'echo-1', stream: true }
    const r = await svc.handleRequest({
      intent,
      body: { model: 'echo-1', stream: true, max_tokens: 8, messages: [{ role: 'user', content: 'ab' }] },
      requestId: 's2',
    })
    const frames = (r as { frames: string[] }).frames
    expect(frames[0]).toContain('message_start')
    expect(frames.at(-1)).toContain('message_stop')
  })
  it('gemini stream produces JSON chunks', async () => {
    const intent: RequestIntent = { format: 'gemini', action: 'generateContent', model: 'echo-1', stream: true }
    const r = await svc.handleRequest({
      intent,
      body: { contents: [{ role: 'user', parts: [{ text: 'zz' }] }] },
      requestId: 's3',
    })
    expect((r as { contentType: string }).contentType).toBe('application/json')
    const frames = (r as { frames: string[] }).frames
    expect(frames.some((f) => f.includes('"zz"'))).toBe(true)
  })
})

describe('handleRequest — errors', () => {
  it('unknown model (bare, model-aware) → ApiProxyHttpError 404', async () => {
    const intent: RequestIntent = { format: 'openai', action: 'chat', model: 'no-such-model', stream: false }
    await expect(
      svc.handleRequest({ intent, body: { model: 'no-such-model', messages: [] }, requestId: 'e1' }),
    ).rejects.toBeInstanceOf(ApiProxyHttpError)
  })
  it('no registry configured → 503', async () => {
    const bare = new ApiProxyService(new ApiHttpServer(() => {}, { port: 0 }))
    const intent: RequestIntent = { format: 'openai', action: 'chat', model: 'echo-1', stream: false }
    await expect(
      bare.handleRequest({ intent, body: { model: 'echo-1', messages: [] }, requestId: 'e2' }),
    ).rejects.toMatchObject({ status: 503 })
  })
})
