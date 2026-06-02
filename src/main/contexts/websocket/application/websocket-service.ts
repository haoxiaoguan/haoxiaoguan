import type { WsServer } from '../../../platform/websocket/ws-server'

// Status shape returned to the renderer (camelCase, matches WsStatus in the
// source frontend contract: { running, port?, connectionCount }).
export interface WsStatusResponse {
  running: boolean
  port?: number
  connectionCount: number
}

// Application service for the local WebSocket push server. Wraps the platform
// WsServer with start/stop/toggle + a status projection
// (get_ws_status / toggle_ws use cases).
export class WebSocketApplicationService {
  constructor(private readonly server: WsServer) {}

  getStatus(): WsStatusResponse {
    const port = this.server.port
    const status: WsStatusResponse = {
      running: this.server.getState() === 'running',
      connectionCount: this.server.connectionCount,
    }
    if (port !== null) status.port = port
    return status
  }

  // The source toggle_ws ignores its arg and flips current state; the frontend
  // passes { enabled } and expects that to be honored. We honor the arg.
  async toggle(enabled: boolean): Promise<void> {
    if (enabled) {
      await this.server.start()
    } else {
      await this.server.stop()
    }
  }
}
