// 路由日志重构（observability v2）IPC handlers。channel 名见 ROUTING_OBS_CHANNELS。
// 全部委托 RoutingObservabilityService（其内部读前会先 flush 缓冲，保证拿到最新）。
// 与旧 routing-log-handlers 并存（PR2b）；前端 PR4 切换、PR5 下线旧。
import { ipcMain } from 'electron'
import { toIpcError } from '../../../ipc/error'
import { ROUTING_OBS_CHANNELS } from '../../../../shared/ipc-channels'
import type { RoutingObservabilityService } from '../application/routing-observability-service'
import type {
  RoutingBreakdownDim,
  RoutingCursor,
  RoutingGranularity,
  RoutingSearchFilter,
  RoutingWindow,
} from '../domain/observability/routing-query'

export function registerRoutingObservabilityHandlers(svc: RoutingObservabilityService): void {
  ipcMain.handle(ROUTING_OBS_CHANNELS.summary, async (_e, window: RoutingWindow) => {
    try {
      return await svc.summary(window)
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  ipcMain.handle(
    ROUTING_OBS_CHANNELS.trend,
    async (_e, window: RoutingWindow, granularity: RoutingGranularity) => {
      try {
        return await svc.trend(window, granularity)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )

  ipcMain.handle(
    ROUTING_OBS_CHANNELS.breakdown,
    async (_e, window: RoutingWindow, dimension: RoutingBreakdownDim) => {
      try {
        return await svc.breakdown(window, dimension)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )

  ipcMain.handle(
    ROUTING_OBS_CHANNELS.topErrors,
    async (_e, window: RoutingWindow, limit?: number) => {
      try {
        return await svc.topErrors(window, limit ?? 20)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )

  ipcMain.handle(ROUTING_OBS_CHANNELS.accountStats, async (_e, window: RoutingWindow) => {
    try {
      return await svc.accountStats(window)
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  ipcMain.handle(
    ROUTING_OBS_CHANNELS.search,
    async (
      _e,
      window: RoutingWindow,
      filter?: RoutingSearchFilter,
      cursor?: RoutingCursor,
      limit?: number,
    ) => {
      try {
        return await svc.search(window, filter ?? {}, cursor, limit ?? 100)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )

  ipcMain.handle(ROUTING_OBS_CHANNELS.detail, async (_e, id: number) => {
    try {
      return await svc.detail(id)
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  ipcMain.handle(ROUTING_OBS_CHANNELS.clear, async () => {
    try {
      await svc.clear()
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })
}
