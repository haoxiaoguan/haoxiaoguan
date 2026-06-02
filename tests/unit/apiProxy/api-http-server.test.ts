import { describe, it, expect, afterEach } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { ApiHttpServer } from '../../../src/main/contexts/apiProxy/infrastructure/http/api-http-server'

let server: ApiHttpServer | null = null

// 一个最小 node handler：对 /ping 回 200 "pong"，其余 404。
function handler(req: IncomingMessage, res: ServerResponse): void {
  if (req.url === '/ping') {
    res.statusCode = 200
    res.end('pong')
  } else {
    res.statusCode = 404
    res.end('not found')
  }
}

afterEach(async () => {
  if (server) {
    await server.stop()
    server = null
  }
})

async function get(port: number, path: string): Promise<{ status: number; body: string }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`)
  return { status: res.status, body: await res.text() }
}

describe('ApiHttpServer', () => {
  it('reports stopped state before start', () => {
    server = new ApiHttpServer(handler, { port: 0 })
    expect(server.getState()).toBe('stopped')
    expect(server.port).toBeNull()
  })

  it('binds 127.0.0.1 and serves the handler, reporting running state', async () => {
    server = new ApiHttpServer(handler, { port: 18790 })
    const port = await server.start()
    expect(port).toBe(18790)
    expect(server.getState()).toBe('running')
    expect(server.port).toBe(18790)
    const ok = await get(port, '/ping')
    expect(ok.status).toBe(200)
    expect(ok.body).toBe('pong')
    const miss = await get(port, '/nope')
    expect(miss.status).toBe(404)
  })

  it('retries the next port when the first is taken', async () => {
    const occupier = new ApiHttpServer(handler, { port: 18800 })
    await occupier.start()
    server = new ApiHttpServer(handler, { port: 18800 })
    const port = await server.start()
    expect(port).toBe(18801)
    await occupier.stop()
  })

  it('stop() returns to stopped state and frees the port', async () => {
    server = new ApiHttpServer(handler, { port: 18810 })
    await server.start()
    await server.stop()
    expect(server.getState()).toBe('stopped')
    expect(server.port).toBeNull()
    // 端口已释放：可被新实例重新绑定。
    const again = new ApiHttpServer(handler, { port: 18810 })
    const p = await again.start()
    expect(p).toBe(18810)
    await again.stop()
  })
})
