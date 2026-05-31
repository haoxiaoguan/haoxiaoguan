import { describe, it, expect, afterEach } from 'vitest'
import { request } from 'node:http'
import { LoopbackServer } from '../../../src/main/platform/oauth/loopback-server'

let server: LoopbackServer | null = null

afterEach(async () => {
  if (server) {
    await server.close()
    server = null
  }
})

function hit(port: number, path: string): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      res.resume()
      res.on('end', () => resolve({ status: res.statusCode ?? 0 }))
    })
    req.on('error', reject)
    req.end()
  })
}

describe('LoopbackServer', () => {
  it('binds the first candidate port', async () => {
    server = new LoopbackServer()
    const port = await server.tryBind([54610, 54611, 54612])
    expect(port).toBe(54610)
    expect(server.port).toBe(54610)
  })

  it('resolves registerPath with decoded query params on the matching request', async () => {
    server = new LoopbackServer()
    const port = await server.tryBind([54620, 54621])
    const pending = server.registerPath('/cb')
    await hit(port, '/cb?code=abc%20123&state=xyz')
    const payload = await pending
    expect(payload.path).toBe('/cb')
    expect(payload.query.code).toBe('abc 123')
    expect(payload.query.state).toBe('xyz')
  })

  it('returns 404 for unmatched paths and removes the route after first hit', async () => {
    server = new LoopbackServer()
    const port = await server.tryBind([54630, 54631])
    const unknown = await hit(port, '/nope')
    expect(unknown.status).toBe(404)

    const pending = server.registerPath('/cb')
    const first = await hit(port, '/cb?code=1')
    expect(first.status).toBe(200)
    await pending
    // route removed: a second hit is now 404
    const second = await hit(port, '/cb?code=2')
    expect(second.status).toBe(404)
  })

  it('rejects duplicate path registration', async () => {
    server = new LoopbackServer()
    await server.tryBind([54640, 54641])
    // first registration stays pending; swallow its close-time rejection
    server.registerPath('/cb').catch(() => {})
    expect(() => server.registerPath('/cb')).toThrow()
  })
})
