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
})
