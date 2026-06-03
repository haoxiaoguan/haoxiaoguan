import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import * as https from 'node:https'
import * as http from 'node:http'
import { serve } from '@hono/node-server'
import type { CertBundle } from './self-signed-cert'

// 本地 HTTP/HTTPS 监听器（apiProxy 上下文）。语义对标 platform/websocket/ws-server.ts
// 的 WsServer：
//   - 仅绑定 127.0.0.1（或配置的 host），
//   - 端口回退：依次尝试 port, port+1, ... 直到 maxPortRetries（默认 10），
//   - getState() 返回 'stopped' | 'running' | 'failed'，
//   - stop() 优雅关闭底层 http.Server。
// 监听器底座是 @hono/node-server（内部即 node:http，零原生依赖）。它接收一个
// node 风格 handler（由 hono-app.ts 的 getRequestListener(app.fetch) 产出），
// 因此本封装与具体 Hono app 解耦、便于单测注入纯 handler。
//
// HTTPS 支持（P2-1，默认关闭）：
//   - 当 tls 字段携带 CertBundle 时，使用 https.createServer。
//   - 未传 tls 时行为与原 http.createServer 逐字相同（零回归）。

export type ApiHttpHandler = (req: IncomingMessage, res: ServerResponse) => void

export interface ApiHttpServerConfig {
  host: string
  port: number
  maxPortRetries: number
  /** 可选 TLS 配置（P2-1）。不传则使用普通 HTTP（默认行为，零回归）。 */
  tls?: CertBundle
}

export const API_HTTP_DEFAULTS: ApiHttpServerConfig = {
  host: '127.0.0.1',
  port: 8788,
  maxPortRetries: 10,
}

export type ApiHttpServerState = 'stopped' | 'running' | 'failed'

export class ApiHttpServer {
  private httpServer: Server | null = null
  private boundPort: number | null = null
  private state: ApiHttpServerState = 'stopped'
  private readonly config: ApiHttpServerConfig

  constructor(
    private readonly handler: ApiHttpHandler,
    config: Partial<ApiHttpServerConfig> = {},
  ) {
    this.config = { ...API_HTTP_DEFAULTS, ...config }
  }

  get port(): number | null {
    return this.boundPort
  }

  getState(): ApiHttpServerState {
    return this.state
  }

  /**
   * 启动监听，依次尝试 port, port+1, ... 直到 maxPortRetries。resolve 实际端口。
   * 全部被占用则置 state='failed' 并抛错。
   */
  async start(): Promise<number> {
    if (this.state === 'running' && this.boundPort !== null) return this.boundPort

    for (let attempt = 0; attempt <= this.config.maxPortRetries; attempt++) {
      const candidate = this.config.port + attempt
      try {
        const port = await this.listen(candidate)
        this.boundPort = port
        this.state = 'running'
        return port
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
          continue
        }
        this.state = 'failed'
        throw err
      }
    }
    this.state = 'failed'
    throw new Error(
      `API HTTP server could not bind any port in ` +
        `[${this.config.port}, ${this.config.port + this.config.maxPortRetries}]`,
    )
  }

  /** 优雅关闭底层 http.Server。 */
  async stop(): Promise<void> {
    const httpServer = this.httpServer
    if (!httpServer) {
      this.state = 'stopped'
      this.boundPort = null
      return
    }
    try {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()))
      })
    } finally {
      // 无论 close 成功与否都复位状态机，避免异常下停在 running 且持有半关闭句柄。
      this.httpServer = null
      this.boundPort = null
      this.state = 'stopped'
    }
  }

  private listen(port: number): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      let server: Server

      if (this.config.tls) {
        // HTTPS 路径（P2-1）：直接用 node:https 创建，不经过 @hono/node-server。
        // 默认 HTTP 路径（serve()）行为逐字不变。
        const tlsCfg = this.config.tls
        server = https.createServer({ cert: tlsCfg.cert, key: tlsCfg.key }, this.handler)
        server.listen(port, this.config.host)
      } else {
        // 默认 HTTP 路径（原始逻辑，逐字不变）。
        // @hono/node-server 的 serve() 同步返回底层 http.Server；端口占用不会 reject，
        // 而是发到 server 的 'error' 事件，所以我们竞态监听 'listening' vs 'error'。
        const httpServer = serve({
          fetch: undefined as never, // 占位：实际请求处理走下面挂的 'request' handler。
          hostname: this.config.host,
          port,
        }) as unknown as Server

        // serve() 已基于 fetch 创建 server；为支持注入纯 node handler（便于测试），
        // 我们移除其默认 request 监听并挂上自定义 handler。
        httpServer.removeAllListeners('request')
        httpServer.on('request', this.handler)
        server = httpServer
      }

      const onError = (err: Error) => {
        server.removeListener('listening', onListening)
        server.close()
        reject(err)
      }
      const onListening = () => {
        server.removeListener('error', onError)
        this.httpServer = server
        // 用真实绑定端口：port:0 时 OS 分配临时端口；固定端口时即等于请求端口。
        const address = server.address()
        resolve(typeof address === 'object' && address !== null ? address.port : port)
      }

      server.once('error', onError)
      server.once('listening', onListening)
    })
  }
}
