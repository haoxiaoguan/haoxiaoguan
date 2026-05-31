import { ipcMain } from 'electron'
import { toIpcError } from '../../../ipc/error'
import { WS_CHANNELS } from '../../../../shared/ipc-channels'
import type { WebSocketApplicationService, WsStatusResponse } from '../application/websocket-service'

// Registers the websocket IPC handlers: get_ws_status / toggle_ws.
// Matches the source frontend wsService contract: getWsStatus() -> WsStatus,
// toggleWs(enabled) where the renderer sends { enabled }.
export function registerWebSocketHandlers(svc: WebSocketApplicationService): void {
  ipcMain.handle(WS_CHANNELS.getWsStatus, async (): Promise<WsStatusResponse> => {
    try {
      return svc.getStatus()
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  ipcMain.handle(WS_CHANNELS.toggleWs, async (_e, arg: { enabled: boolean }) => {
    try {
      await svc.toggle(arg?.enabled ?? false)
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })
}
