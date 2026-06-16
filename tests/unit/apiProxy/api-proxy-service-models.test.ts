// /v1/models 接入 KiroModelCatalog：实时快照替换静态 kiro 清单 + 严格门控（无可用账号不下发 kiro）。
import { describe, it, expect } from 'vitest'
import { createHonoApp } from '../../../src/main/contexts/apiProxy/infrastructure/http/hono-app'
import { ApiHttpServer } from '../../../src/main/contexts/apiProxy/infrastructure/http/api-http-server'
import { ApiProxyService, type KiroModelSource } from '../../../src/main/contexts/apiProxy/application/api-proxy-service'
import { PlatformRegistry } from '../../../src/main/contexts/apiProxy/infrastructure/platform-registry'
import { EchoUpstreamAdapter } from '../../../src/main/contexts/apiProxy/infrastructure/adapters/echo/echo-adapter'
import { makePlatformAliasResolver } from '../../../src/main/contexts/apiProxy/domain/platform-alias'
import type { PlatformUpstreamAdapter } from '../../../src/main/contexts/apiProxy/domain/platform-adapter'

const AUTH = { authorization: 'Bearer k' }

// 最小 kiro 适配器：仅 listModels（静态）用于验证「被快照替换」；chat/* 不会在 models 路径触发。
function fakeKiro(): PlatformUpstreamAdapter {
  return {
    platform: 'kiro',
    supportsModel: (m: string) => /^claude-/.test(m),
    listModels: () => [{ id: 'claude-static-4.8', displayName: 'static', ownedBy: 'anthropic' }],
    chat: async () => {
      throw new Error('unused')
    },
    chatStream: () => {
      throw new Error('unused')
    },
    classifyError: () => 'SERVER',
  } as PlatformUpstreamAdapter
}

function appWith(catalog: KiroModelSource): ReturnType<typeof createHonoApp> {
  const registry = new PlatformRegistry()
  registry.register(new EchoUpstreamAdapter())
  registry.register(fakeKiro())
  const service = new ApiProxyService(new ApiHttpServer(() => {}, { port: 0 }), {
    registry,
    kiroModelCatalog: catalog,
  })
  return createHonoApp({
    service,
    auth: { keysProvider: async () => ['k'], allowAnonymousLoopback: true },
    resolvePlatformAlias: makePlatformAliasResolver((n) => registry.get(n) !== undefined),
  })
}

async function modelIds(app: ReturnType<typeof createHonoApp>): Promise<string[]> {
  const res = await app.request('/v1/models', { headers: AUTH })
  expect(res.status).toBe(200)
  return ((await res.json()) as { data: { id: string }[] }).data.map((m) => m.id)
}

describe('/v1/models 接入 KiroModelCatalog', () => {
  it('catalog 有 live 模型 → 下发 kr/<live>，替换静态 kiro，其余平台不受影响', async () => {
    const app = appWith({
      listForServe: () => [{ id: 'claude-live-4.5', displayName: 'live', ownedBy: 'anthropic' }],
    })
    const ids = await modelIds(app)
    expect(ids).toContain('kr/claude-live-4.5')
    expect(ids).not.toContain('kr/claude-static-4.8')
    expect(ids).toContain('echo-1')
  })

  it('catalog 门控为空（无可用账号）→ 不下发任何 kiro 模型', async () => {
    const app = appWith({ listForServe: () => [] })
    const ids = await modelIds(app)
    expect(ids.some((id) => id.startsWith('kr/'))).toBe(false)
    expect(ids).toContain('echo-1')
  })
})
