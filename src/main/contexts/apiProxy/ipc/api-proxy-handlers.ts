import { ipcMain } from 'electron'
import { toIpcError } from '../../../ipc/error'
import { API_PROXY_CHANNELS } from '../../../../shared/ipc-channels'
import type { ApiProxyService, ApiProxyStatus } from '../application/api-proxy-service'
import type { AccountHealthTracker } from '../domain/account-selection/account-health-tracker'
import type { KiroAccountPort } from '../infrastructure/adapters/kiro/kiro-ports'
import { makeClearSuspensionHandler } from '../application/clear-suspension-handler'

// 注册 apiProxy 的 IPC handlers：start / stop / getStatus / clearAccountSuspension。
// start/stop 均返回最新状态投影，方便 renderer 一次拿到结果免再查。
export function registerApiProxyHandlers(
  svc: ApiProxyService,
  health?: AccountHealthTracker,
  accounts?: KiroAccountPort,
): void {
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

  if (health && accounts) {
    const clearSuspensionHandler = makeClearSuspensionHandler(health, accounts)
    ipcMain.handle(API_PROXY_CHANNELS.clearAccountSuspension, async (_e, accountId: string): Promise<void> => {
      try {
        await clearSuspensionHandler(accountId)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    })
  }
}
