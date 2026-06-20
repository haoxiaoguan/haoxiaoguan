/**
 * analytics 上下文 IPC handlers。
 * 参照 usage-handlers.ts 模式：ipcMain.handle + toIpcError。
 */
import { ipcMain } from 'electron'
import { toIpcError } from '../../../ipc/error'
import { ANALYTICS_CHANNELS } from '../../../../shared/ipc-channels'
import type { UsageEventQueryService } from '../application/usage-event-query-service'
import type { PricingService } from '../application/pricing-service'
import type {
  UsageEventWindow,
  UsageEventGranularity,
  UsageEventTrendMetric,
  UsageEventSearchFilter,
  UsageEventCursor,
} from '../domain/usage-event'

export function registerAnalyticsHandlers(
  querySvc: UsageEventQueryService,
  pricingSvc: PricingService,
): void {
  // summary — args: window, agentId?
  ipcMain.handle(ANALYTICS_CHANNELS.summary, async (_e, window: UsageEventWindow, agentId?: string) => {
    try {
      return await querySvc.summary(window, agentId)
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  // trend — args: window, granularity, metric, agentId?
  ipcMain.handle(
    ANALYTICS_CHANNELS.trend,
    async (
      _e,
      window: UsageEventWindow,
      granularity: UsageEventGranularity,
      metric: UsageEventTrendMetric,
      agentId?: string,
    ) => {
      try {
        return await querySvc.trend(window, granularity, metric, agentId)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )

  // agentBreakdown — arg: window
  ipcMain.handle(ANALYTICS_CHANNELS.agentBreakdown, async (_e, window: UsageEventWindow) => {
    try {
      return await querySvc.agentBreakdown(window)
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  // modelBreakdown — args: window, agentId?
  ipcMain.handle(
    ANALYTICS_CHANNELS.modelBreakdown,
    async (_e, window: UsageEventWindow, agentId?: string) => {
      try {
        return await querySvc.modelBreakdown(window, agentId)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )

  // search — args: window, filter, cursor?, limit?
  ipcMain.handle(
    ANALYTICS_CHANNELS.search,
    async (
      _e,
      window: UsageEventWindow,
      filter: UsageEventSearchFilter,
      cursor?: UsageEventCursor,
      limit?: number,
    ) => {
      try {
        return await querySvc.search(window, filter, cursor, limit)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )

  // listPricing — no args
  ipcMain.handle(ANALYTICS_CHANNELS.listPricing, async () => {
    try {
      return await pricingSvc.listPricing()
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  // upsertPricing — arg: row
  ipcMain.handle(ANALYTICS_CHANNELS.upsertPricing, async (_e, row: import('../domain/usage-event').ModelPricingRow) => {
    try {
      await pricingSvc.upsertPricing(row)
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  // deletePricing — arg: modelId
  ipcMain.handle(ANALYTICS_CHANNELS.deletePricing, async (_e, modelId: string) => {
    try {
      await pricingSvc.deletePricing(modelId)
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  // getPricingConfig — arg: agentId
  ipcMain.handle(ANALYTICS_CHANNELS.getPricingConfig, async (_e, agentId: string) => {
    try {
      return await pricingSvc.getConfig(agentId)
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  // setPricingConfig — args: agentId, multiplier, source
  ipcMain.handle(
    ANALYTICS_CHANNELS.setPricingConfig,
    async (_e, agentId: string, multiplier: number, source: 'request' | 'response') => {
      try {
        await pricingSvc.setConfig(agentId, multiplier, source)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )
}
