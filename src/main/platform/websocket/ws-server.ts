import { WebSocketServer, WebSocket, type RawData } from 'ws'

// Local WebSocket push server (replaces Rust tokio-tungstenite WebSocketService,
// map_primitives.md §WebSocketService).
//
//  - binds 127.0.0.1 only,
//  - port fallback: tries port, port+1, ... up to maxPortRetries (default 10),
//  - caps concurrent connections at maxConnections (default 20); excess sockets
//    are closed immediately,
//  - server-push only: inbound client messages are ignored,
//  - broadcast(msg) fans a text frame out to all live clients, pruning dead ones,
//  - graceful shutdown closes all sockets then the server.

export interface WsServerConfig {
  port: number
  maxConnections: number
  maxPortRetries: number
}

export const WS_DEFAULTS: WsServerConfig = {
  port: 19528,
  maxConnections: 20,
  maxPortRetries: 10,
}

export type WsServerState = 'stopped' | 'running' | 'failed'

export class WsServer {
  private wss: WebSocketServer | null = null
  private readonly clients = new Set<WebSocket>()
  private boundPort: number | null = null
  private state: WsServerState = 'stopped'
  private readonly config: WsServerConfig

  constructor(config: Partial<WsServerConfig> = {}) {
    this.config = { ...WS_DEFAULTS, ...config }
  }

  get port(): number | null {
    return this.boundPort
  }

  getState(): WsServerState {
    return this.state
  }

  get connectionCount(): number {
    return this.clients.size
  }

  /**
   * Start the server, trying port, port+1, ... up to maxPortRetries. Resolves
   * with the bound port. Sets state to 'failed' and throws if all are taken.
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
      `WebSocket server could not bind any port in ` +
        `[${this.config.port}, ${this.config.port + this.config.maxPortRetries}]`,
    )
  }

  /** Fan a text message out to every connected client; prune dead sockets. */
  broadcast(msg: string): void {
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg)
      } else if (
        client.readyState === WebSocket.CLOSED ||
        client.readyState === WebSocket.CLOSING
      ) {
        this.clients.delete(client)
      }
    }
  }

  /** Gracefully close all client sockets and the server. */
  async stop(): Promise<void> {
    for (const client of this.clients) {
      client.terminate()
    }
    this.clients.clear()
    const wss = this.wss
    if (!wss) {
      this.state = 'stopped'
      return
    }
    await new Promise<void>((resolve) => wss.close(() => resolve()))
    this.wss = null
    this.boundPort = null
    this.state = 'stopped'
  }

  private listen(port: number): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const wss = new WebSocketServer({ host: '127.0.0.1', port })

      const onError = (err: Error) => {
        wss.removeListener('listening', onListening)
        wss.close()
        reject(err)
      }
      const onListening = () => {
        wss.removeListener('error', onError)
        this.wss = wss
        this.wireConnectionHandling(wss)
        resolve(port)
      }

      wss.once('error', onError)
      wss.once('listening', onListening)
    })
  }

  private wireConnectionHandling(wss: WebSocketServer): void {
    wss.on('connection', (socket: WebSocket) => {
      if (this.clients.size >= this.config.maxConnections) {
        socket.close(1013, 'too many connections')
        return
      }
      this.clients.add(socket)
      // Server-push only: ignore inbound frames, just drop on close/error.
      socket.on('message', (_data: RawData) => {})
      socket.on('close', () => this.clients.delete(socket))
      socket.on('error', () => this.clients.delete(socket))
    })
  }
}
