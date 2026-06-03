// /v1/responses 端到端（经 Echo 占位上游）：覆盖 service 的 responses 专属编排分支
// （历史链 → responsesToIR → adapter.chat/chatStream → 序列化 → 落盘）。
// 装配最小化：PlatformRegistry(+Echo) + ResponsesStore（落盘到临时目录），不起 HTTP，
// 直接喂 handleRequest 一个已解析 intent（形态对齐 router 对 /v1/responses 的产出）。
import { describe, it, expect } from 'vitest'
import { ApiProxyService } from '../../../src/main/contexts/apiProxy/application/api-proxy-service'
import { PlatformRegistry } from '../../../src/main/contexts/apiProxy/infrastructure/platform-registry'
import { EchoUpstreamAdapter } from '../../../src/main/contexts/apiProxy/infrastructure/adapters/echo/echo-adapter'
import { ResponsesStore } from '../../../src/main/contexts/apiProxy/infrastructure/responses-store/responses-store'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// EchoUpstreamAdapter 默认 platform 'echo'（无参构造，同 e2e-echo.test.ts）。
function makeService(): { svc: ApiProxyService; store: ResponsesStore } {
  const registry = new PlatformRegistry()
  registry.register(new EchoUpstreamAdapter())
  const store = new ResponsesStore({ dir: mkdtempSync(join(tmpdir(), 'resp-e2e-')) })
  const svc = new ApiProxyService(undefined, { registry, responsesStore: store })
  return { svc, store }
}

describe('/v1/responses 经 Echo', () => {
  it('非流式 string input → output message + 存盘', async () => {
    const { svc } = makeService()
    const r = await svc.handleRequest({
      intent: { platform: 'echo', format: 'openai-responses', action: 'responses', model: 'echo-1', stream: false },
      body: { model: 'echo-1', input: 'hello', store: true },
      requestId: 'req1',
    })
    expect(r.kind).toBe('json')
    const obj = (r as { body: { id: string; output: { type: string }[] } }).body
    expect(obj.id.startsWith('resp_')).toBe(true)
    expect(obj.output.some((o) => o.type === 'message')).toBe(true)
  })

  it('流式 string input → 语义 SSE + [DONE]', async () => {
    const { svc } = makeService()
    const r = await svc.handleRequest({
      intent: { platform: 'echo', format: 'openai-responses', action: 'responses', model: 'echo-1', stream: true },
      body: { model: 'echo-1', input: 'hi', stream: true },
      requestId: 'req2',
    })
    expect(r.kind).toBe('stream')
    const joined = (r as { frames: string[] }).frames.join('')
    expect(joined).toContain('event: response.created')
    expect(joined).toContain('event: response.completed')
    expect(joined).toContain('data: [DONE]')
  })

  it('previous_response_id 链：二轮带上一轮历史', async () => {
    // 同一个 svc 实例 → 同一个 ResponsesStore 落盘目录；r1 store:true 落盘后 r2 可载回。
    const { svc } = makeService()
    const r1 = await svc.handleRequest({
      intent: { platform: 'echo', format: 'openai-responses', action: 'responses', model: 'echo-1', stream: false },
      body: { model: 'echo-1', input: 'first', store: true },
      requestId: 'r1',
    })
    const id1 = (r1 as { body: { id: string } }).body.id
    const r2 = await svc.handleRequest({
      intent: { platform: 'echo', format: 'openai-responses', action: 'responses', model: 'echo-1', stream: false },
      body: { model: 'echo-1', input: 'second', previous_response_id: id1, store: true },
      requestId: 'r2',
    })
    expect((r2 as { body: { previous_response_id?: string } }).body.previous_response_id).toBe(id1)
  })

  it('typed items input：function_call_output 配对', async () => {
    const { svc } = makeService()
    const r = await svc.handleRequest({
      intent: { platform: 'echo', format: 'openai-responses', action: 'responses', model: 'echo-1', stream: false },
      body: {
        model: 'echo-1',
        input: [
          { type: 'message', role: 'user', content: 'q' },
          { type: 'function_call', call_id: 'c1', name: 'f', arguments: '{}' },
          { type: 'function_call_output', call_id: 'c1', output: 'r' },
        ],
      },
      requestId: 'r3',
    })
    expect(r.kind).toBe('json')
  })
})
