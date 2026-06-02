import { describe, it, expect, afterEach } from 'vitest'
import { ApiHttpServer } from '../../../src/main/contexts/apiProxy/infrastructure/http/api-http-server'
import { createApiRequestListener, type HonoAppDeps } from '../../../src/main/contexts/apiProxy/infrastructure/http/hono-app'
import { ApiProxyService } from '../../../src/main/contexts/apiProxy/application/api-proxy-service'
import { PlatformRegistry } from '../../../src/main/contexts/apiProxy/infrastructure/platform-registry'
import { EchoUpstreamAdapter } from '../../../src/main/contexts/apiProxy/infrastructure/adapters/echo/echo-adapter'

let svc: ApiProxyService | null = null

afterEach(async () => {
  if (svc) {
    await svc.stop()
    svc = null
  }
})

function makeService(): ApiProxyService {
  // 方案 B（attachServer）解循环依赖：先建 registry + service（无 server），
  // 再用真实 deps 建 listener + server，最后 attachServer 回填。无需 Proxy。
  const registry = new PlatformRegistry()
  registry.register(new EchoUpstreamAdapter())
  const service = new ApiProxyService(undefined, { registry })
  const deps: HonoAppDeps = {
    service,
    auth: { keys: [], allowAnonymousLoopback: true },
    knownPlatforms: registry.knownPlatforms(),
  }
  // port 0 让 OS 选空闲端口，避免 CI 端口冲突。
  const server = new ApiHttpServer(createApiRequestListener(deps), { port: 0 })
  service.attachServer(server)
  return service
}

describe('ApiProxyService', () => {
  // ---- M1 既有断言（保留，不回归）----
  it('reports stopped status before start', () => {
    svc = makeService()
    const status = svc.getStatus()
    expect(status.state).toBe('stopped')
    expect(status.port).toBeUndefined()
  })

  it('start() launches the server and getStatus reports running + a bound port', async () => {
    svc = makeService()
    await svc.start()
    const status = svc.getStatus()
    expect(status.state).toBe('running')
    expect(typeof status.port).toBe('number')
  })

  it('serves /health over HTTP after start', async () => {
    svc = makeService()
    await svc.start()
    const port = svc.getStatus().port as number
    const res = await fetch(`http://127.0.0.1:${port}/health`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('stop() returns to stopped status', async () => {
    svc = makeService()
    await svc.start()
    await svc.stop()
    expect(svc.getStatus().state).toBe('stopped')
    expect(svc.getStatus().port).toBeUndefined()
  })
})
