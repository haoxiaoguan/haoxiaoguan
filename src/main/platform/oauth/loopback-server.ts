import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

// Reusable OAuth loopback HTTP server (replaces Rust tiny_http + oneshot).
//
// 对应 OAuthCallbackServer (map_primitives.md):
//  - binds 127.0.0.1 on the first free port from a candidate list (EADDRINUSE
//    is treated as "try next", any other error rejects),
//  - registerPath(path) returns a Promise that resolves with the URL-decoded
//    query params on the FIRST matching request, then removes that route,
//  - unmatched paths get 404,
//  - no busy-polling: delivery is driven by the http 'request' event and a
//    pending-resolver map (the Promise/EventEmitter analogue of Rust oneshot).

export interface CallbackPayload {
  path: string
  query: Record<string, string>
}

interface PendingRoute {
  resolve: (payload: CallbackPayload) => void
  reject: (err: Error) => void
}

// Default candidate ports from spec §5.3.
export const DEFAULT_CANDIDATE_PORTS = [
  3128, 4649, 6588, 8008, 9091, 49153, 50153, 51153, 52153, 53153,
]

const SUCCESS_HTML =
  '<!doctype html><html><head><meta charset="utf-8"><title>授权完成</title></head>' +
  '<body style="font-family:system-ui;text-align:center;padding-top:4rem">' +
  '<h2>授权完成，可以关闭此页面。</h2></body></html>'

export class LoopbackServer {
  private server: Server | null = null
  private boundPort: number | null = null
  private readonly routes = new Map<string, PendingRoute>()

  /**
   * Bind 127.0.0.1 to the first free port among the candidates. Returns the
   * bound port. Throws if every candidate is taken (or another error occurs).
   */
  async tryBind(candidatePorts: number[] = DEFAULT_CANDIDATE_PORTS): Promise<number> {
    if (this.boundPort !== null) return this.boundPort

    const server = createServer((req, res) => this.handleRequest(req, res))
    this.attachConnectionGuards(server)

    for (const port of candidatePorts) {
      try {
        await this.listenOnce(server, port)
        this.server = server
        this.boundPort = port
        return port
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
          continue
        }
        throw err
      }
    }
    throw new Error(`no free port among candidates: ${candidatePorts.join(', ')}`)
  }

  get port(): number | null {
    return this.boundPort
  }

  /**
   * Register a one-shot callback route. The returned Promise resolves with the
   * query params of the first request whose pathname matches `path`, after
   * which the route is removed. Registering a path already pending throws.
   */
  registerPath(path: string): Promise<CallbackPayload> {
    const normalized = this.normalize(path)
    if (this.routes.has(normalized)) {
      throw new Error(`path already registered: ${normalized}`)
    }
    return new Promise<CallbackPayload>((resolve, reject) => {
      this.routes.set(normalized, { resolve, reject })
    })
  }

  /** Reject and clear any still-pending routes, then close the server. */
  async close(): Promise<void> {
    for (const [, route] of this.routes) {
      route.reject(new Error('loopback server closed before callback'))
    }
    this.routes.clear()
    const server = this.server
    if (!server) return
    await new Promise<void>((resolve) => server.close(() => resolve()))
    this.server = null
    this.boundPort = null
  }

  private listenOnce(server: Server, port: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => {
        server.removeListener('listening', onListening)
        reject(err)
      }
      const onListening = () => {
        server.removeListener('error', onError)
        resolve()
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(port, '127.0.0.1')
    })
  }

  private attachConnectionGuards(server: Server): void {
    // Loopback callbacks are short-lived; keep sockets from lingering.
    server.keepAliveTimeout = 1000
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${this.boundPort ?? 0}`)
    const route = this.routes.get(this.normalize(url.pathname))
    if (!route) {
      res.statusCode = 404
      res.end('Not Found')
      return
    }
    this.routes.delete(this.normalize(url.pathname))

    const query: Record<string, string> = {}
    for (const [k, v] of url.searchParams.entries()) {
      query[k] = v
    }

    res.statusCode = 200
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end(SUCCESS_HTML)

    route.resolve({ path: this.normalize(url.pathname), query })
  }

  private normalize(path: string): string {
    if (!path.startsWith('/')) return `/${path}`
    return path
  }
}
