import { create } from 'zustand'
import type {
  RoutingWindowDto,
  RoutingGranularityDto,
  RoutingBreakdownDimDto,
  RoutingSummaryDto,
  RoutingTrendPointDto,
  RoutingBreakdownRowDto,
  RoutingErrorRowDto,
  RoutingRecentRowDto,
  RoutingRecentFilterDto,
} from '@shared/api-types'
import { bridge } from '../services/bridge'

interface RoutingLogState {
  summary: RoutingSummaryDto | null
  trend: RoutingTrendPointDto[]
  breakdown: RoutingBreakdownRowDto[]
  errors: RoutingErrorRowDto[]
  recent: RoutingRecentRowDto[]
  loading: boolean
  error: string | null

  /** 拉取概览（汇总 + 趋势 + Top 错误）。 */
  fetchOverview: (window: RoutingWindowDto, granularity: RoutingGranularityDto) => Promise<void>
  /** 拉取维度下钻。 */
  fetchBreakdown: (window: RoutingWindowDto, dimension: RoutingBreakdownDimDto) => Promise<void>
  /** 拉取最近请求明细。 */
  fetchRecent: (limit: number, filter: RoutingRecentFilterDto) => Promise<void>
  /** 清空持久化日志并重置本地数据。 */
  clear: () => Promise<void>
}

export const useRoutingLogStore = create<RoutingLogState>((set) => ({
  summary: null,
  trend: [],
  breakdown: [],
  errors: [],
  recent: [],
  loading: false,
  error: null,

  fetchOverview: async (window, granularity) => {
    set({ loading: true, error: null })
    try {
      const [summary, trend, errors] = await Promise.all([
        bridge().routingLog.summary(window),
        bridge().routingLog.trend(window, granularity),
        bridge().routingLog.topErrors(window, 20),
      ])
      set({ summary, trend, errors, loading: false })
    } catch (e) {
      set({ error: String(e), loading: false })
    }
  },

  fetchBreakdown: async (window, dimension) => {
    try {
      set({ breakdown: await bridge().routingLog.breakdown(window, dimension) })
    } catch (e) {
      set({ error: String(e) })
    }
  },

  fetchRecent: async (limit, filter) => {
    try {
      set({ recent: await bridge().routingLog.recent(limit, filter) })
    } catch (e) {
      set({ error: String(e) })
    }
  },

  clear: async () => {
    try {
      await bridge().routingLog.clear()
      set({ summary: null, trend: [], breakdown: [], errors: [], recent: [] })
    } catch (e) {
      set({ error: String(e) })
    }
  },
}))
