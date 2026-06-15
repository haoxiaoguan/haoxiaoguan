// 路由日志分析模块的 IPC handlers。channel 名见 ROUTING_LOG_CHANNELS。
// 全部委托 RoutingLogService（其内部读前会先 flush 缓冲，保证拿到最新）。
import { ipcMain } from 'electron'
import { toIpcError } from '../../../ipc/error'
import { ROUTING_LOG_CHANNELS } from '../../../../shared/ipc-channels'
import type { RoutingLogService } from '../application/routing-log-service'
import type {
  RoutingBreakdownDim,
  RoutingGranularity,
  RoutingRecentFilter,
  RoutingWindow,
} from '../domain/observability/routing-log-record'

export function registerRoutingLogHandlers(svc: RoutingLogService): void {
  ipcMain.handle(ROUTING_LOG_CHANNELS.summary, async (_e, window: RoutingWindow) => {
    try {
      return await svc.summary(window)
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  ipcMain.handle(
    ROUTING_LOG_CHANNELS.trend,
    async (_e, window: RoutingWindow, granularity: RoutingGranularity) => {
      try {
        return await svc.trend(window, granularity)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )

  ipcMain.handle(
    ROUTING_LOG_CHANNELS.breakdown,
    async (_e, window: RoutingWindow, dimension: RoutingBreakdownDim) => {
      try {
        return await svc.breakdown(window, dimension)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )

  ipcMain.handle(
    ROUTING_LOG_CHANNELS.topErrors,
    async (_e, window: RoutingWindow, limit?: number) => {
      try {
        return await svc.topErrors(window, limit ?? 20)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )

  ipcMain.handle(
    ROUTING_LOG_CHANNELS.recent,
    async (_e, limit?: number, filter?: RoutingRecentFilter) => {
      try {
        return await svc.recent(limit ?? 100, filter ?? {})
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )

  ipcMain.handle(ROUTING_LOG_CHANNELS.clear, async () => {
    try {
      await svc.clear()
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })
}
