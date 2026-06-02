import { ipcMain } from 'electron'
import { toIpcError } from '../../../ipc/error'
import { API_PROXY_CHANNELS } from '../../../../shared/ipc-channels'
import type { ApiProxyService, ApiProxyStatus } from '../application/api-proxy-service'

// 注册 apiProxy 的 IPC handlers：start / stop / getStatus。
// start/stop 均返回最新状态投影，方便 renderer 一次拿到结果免再查。
export function registerApiProxyHandlers(svc: ApiProxyService): void {
  ipcMain.handle(API_PROXY_CHANNELS.start, async (): Promise<ApiProxyStatus> => {
    try {
      await svc.start()
      return svc.getStatus()
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  ipcMain.handle(API_PROXY_CHANNELS.stop, async (): Promise<ApiProxyStatus> => {
    try {
      await svc.stop()
      return svc.getStatus()
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  ipcMain.handle(API_PROXY_CHANNELS.getStatus, async (): Promise<ApiProxyStatus> => {
    try {
      return svc.getStatus()
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })
}
