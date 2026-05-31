import { describe, it, expect, afterEach } from 'vitest'
import { WsServer } from '../../../src/main/platform/websocket/ws-server'
import { WebSocketApplicationService } from '../../../src/main/contexts/websocket/application/websocket-service'

let svc: WebSocketApplicationService | null = null

afterEach(async () => {
  // Ensure the server is stopped so the test process can exit cleanly.
  if (svc) {
    await svc.toggle(false)
    svc = null
  }
})

describe('WebSocketApplicationService', () => {
  it('reports stopped status before being toggled on', () => {
    svc = new WebSocketApplicationService(new WsServer({ port: 0 }))
    const status = svc.getStatus()
    expect(status.running).toBe(false)
    expect(status.connectionCount).toBe(0)
    expect(status.port).toBeUndefined()
  })

  it('starts on toggle(true) and reports a bound port', async () => {
    // port 0 lets the OS pick a free port, avoiding collisions in CI.
    svc = new WebSocketApplicationService(new WsServer({ port: 0 }))
    await svc.toggle(true)
    const status = svc.getStatus()
    expect(status.running).toBe(true)
    expect(typeof status.port).toBe('number')
  })

  it('stops on toggle(false)', async () => {
    svc = new WebSocketApplicationService(new WsServer({ port: 0 }))
    await svc.toggle(true)
    await svc.toggle(false)
    expect(svc.getStatus().running).toBe(false)
  })
})
