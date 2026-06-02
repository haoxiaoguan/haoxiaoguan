import type { ApiHttpServer, ApiHttpServerState } from '../infrastructure/http/api-http-server'

// 返回给 renderer 的状态投影（spec §13：apiProxy:getStatus → { state, port? }）。
// M1 只含 state + 可选 port；M2+ 再扩 startedAt/accountsHealthy/accountsTotal。
export interface ApiProxyStatus {
  state: ApiHttpServerState
  port?: number
}

// apiProxy 上下文的 application 服务。包装 ApiHttpServer，提供 start/stop +
// 状态投影。语义对标 contexts/websocket/application/websocket-service.ts。
export class ApiProxyService {
  constructor(private readonly server: ApiHttpServer) {}

  async start(): Promise<void> {
    await this.server.start()
  }

  async stop(): Promise<void> {
    await this.server.stop()
  }

  getStatus(): ApiProxyStatus {
    const port = this.server.port
    const status: ApiProxyStatus = { state: this.server.getState() }
    if (port !== null) status.port = port
    return status
  }
}
