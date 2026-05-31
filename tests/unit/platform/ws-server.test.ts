import { describe, it, expect, afterEach } from 'vitest'
import { WebSocket } from 'ws'
import { WsServer } from '../../../src/main/platform/websocket/ws-server'

let server: WsServer | null = null

afterEach(async () => {
  if (server) {
    await server.stop()
    server = null
  }
})

function connect(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    ws.once('open', () => resolve(ws))
    ws.once('error', reject)
  })
}

function nextMessage(ws: WebSocket): Promise<string> {
  return new Promise((resolve) => {
    ws.once('message', (data) => resolve(data.toString()))
  })
}

describe('WsServer', () => {
  it('binds 127.0.0.1 on the default-relative port and reports running state', async () => {
    server = new WsServer({ port: 19620 })
    const port = await server.start()
    expect(port).toBe(19620)
    expect(server.getState()).toBe('running')
  })

  it('broadcasts a server-push message to connected clients', async () => {
    server = new WsServer({ port: 19630 })
    const port = await server.start()
    const ws = await connect(port)
    const received = nextMessage(ws)
    server.broadcast('hello')
    expect(await received).toBe('hello')
    ws.close()
  })

  it('caps connections at maxConnections', async () => {
    server = new WsServer({ port: 19640, maxConnections: 1 })
    const port = await server.start()
    const a = await connect(port)
    // second connection is accepted then immediately closed by the server
    const b = new WebSocket(`ws://127.0.0.1:${port}`)
    const closeCode = await new Promise<number>((resolve) => {
      b.once('close', (code) => resolve(code))
    })
    expect(closeCode).toBe(1013)
    a.close()
  })

  it('retries the next port when the first is taken', async () => {
    const occupier = new WsServer({ port: 19650 })
    await occupier.start()
    server = new WsServer({ port: 19650 })
    const port = await server.start()
    expect(port).toBe(19651)
    await occupier.stop()
  })
})
