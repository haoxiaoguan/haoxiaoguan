import { ipcMain } from 'electron'
import { toIpcError } from '../../../ipc/error'
import { API_PROXY_CHANNELS } from '../../../../shared/ipc-channels'
import type { ApiProxyService } from '../application/api-proxy-service'
import type { ApiProxyStatus } from '../../../../shared/api-types'
import type { AccountHealthTracker } from '../domain/account-selection/account-health-tracker'
import type { KiroAccountPort } from '../infrastructure/adapters/kiro/kiro-ports'
import { makeClearSuspensionHandler } from '../application/clear-suspension-handler'
import { makeAccountPoolHealthHandler } from '../application/account-pool-health-handler'
import type { ApiProxyKeyService } from '../application/api-proxy-key-service'
import type { ProxyRequestLog } from '../domain/observability/proxy-request-log'

// 注册 apiProxy 的 IPC handlers：start / stop / getStatus / clearAccountSuspension。
// start/stop 均返回最新状态投影，方便 renderer 一次拿到结果免再查。
export function registerApiProxyHandlers(
  svc: ApiProxyService,
  health?: AccountHealthTracker,
  accounts?: KiroAccountPort,
  keyService?: ApiProxyKeyService,
  quotaResetMs?: number,
  requestLog?: ProxyRequestLog,
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

    const poolHealthHandler = makeAccountPoolHealthHandler(health, accounts, quotaResetMs ?? 3_600_000)
    ipcMain.handle(API_PROXY_CHANNELS.getAccountPoolHealth, async () => {
      try {
        return await poolHealthHandler()
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    })
  }

  if (keyService) {
    ipcMain.handle(API_PROXY_CHANNELS.createClientKey, async (_e, name: string) => {
      try {
        return await keyService.create(name)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    })
    ipcMain.handle(API_PROXY_CHANNELS.listClientKeys, async () => {
      try {
        return await keyService.list()
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    })
    ipcMain.handle(API_PROXY_CHANNELS.setClientKeyActive, async (_e, id: string, isActive: boolean) => {
      try {
        await keyService.setActive(id, isActive)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    })
    ipcMain.handle(API_PROXY_CHANNELS.deleteClientKey, async (_e, id: string) => {
      try {
        await keyService.delete(id)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    })
  }

  if (requestLog) {
    ipcMain.handle(API_PROXY_CHANNELS.getRequestLog, async (_e, limit?: number) => {
      try {
        return requestLog.listRecent(limit)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    })
    ipcMain.handle(API_PROXY_CHANNELS.clearRequestLog, async (): Promise<void> => {
      try {
        requestLog.clear()
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    })
  }
}
