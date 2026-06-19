import { create } from 'zustand'
import type {
  RoutingObsWindowDto,
  RoutingObsGranularityDto,
  RoutingObsBreakdownDimDto,
  RoutingObsSummaryDto,
  RoutingObsTrendPointDto,
  RoutingObsBreakdownRowDto,
  RoutingObsErrorRowDto,
  RoutingObsEventDto,
  RoutingObsLiveEventDto,
  RoutingObsSearchFilterDto,
  RoutingObsCursorDto,
} from '@shared/api-types'
import { bridge } from '../services/bridge'

const SEARCH_PAGE = 100
/** 实时模式下检索列表保留的最大行数（防无限增长）。 */
const LIVE_MAX_ROWS = 500

interface RoutingObsState {
  summary: RoutingObsSummaryDto | null
  trend: RoutingObsTrendPointDto[]
  breakdown: RoutingObsBreakdownRowDto[]
  errors: RoutingObsErrorRowDto[]
  /** 检索结果（keyset 分页累积；实时模式下新事件注入头部）。 */
  rows: RoutingObsEventDto[]
  cursor: RoutingObsCursorDto | undefined
  hasMore: boolean
  searching: boolean
  /** 详情抽屉当前行（点击列表行即设；行数据已完整，无需再查后端）。 */
  detail: RoutingObsEventDto | null
  /** 实时模式：开启后 onEvent 推来的批次注入列表头部。 */
  live: boolean
  loading: boolean
  error: string | null

  fetchOverview: (
    window: RoutingObsWindowDto,
    granularity: RoutingObsGranularityDto,
  ) => Promise<void>
  fetchBreakdown: (
    window: RoutingObsWindowDto,
    dimension: RoutingObsBreakdownDimDto,
  ) => Promise<void>
  searchFirst: (window: RoutingObsWindowDto, filter: RoutingObsSearchFilterDto) => Promise<void>
  searchMore: (window: RoutingObsWindowDto, filter: RoutingObsSearchFilterDto) => Promise<void>
  openDetail: (row: RoutingObsEventDto) => void
  closeDetail: () => void
  setLive: (on: boolean) => void
  pushLive: (batch: RoutingObsLiveEventDto[]) => void
  clear: () => Promise<void>
}

export const useRoutingObsStore = create<RoutingObsState>((set, get) => ({
  summary: null,
  trend: [],
  breakdown: [],
  errors: [],
  rows: [],
  cursor: undefined,
  hasMore: false,
  searching: false,
  detail: null,
  live: false,
  loading: false,
  error: null,

  fetchOverview: async (window, granularity) => {
    set({ loading: true, error: null })
    try {
      const [summary, trend, errors] = await Promise.all([
        bridge().routingObs.summary(window),
        bridge().routingObs.trend(window, granularity),
        bridge().routingObs.topErrors(window, 20),
      ])
      set({ summary, trend, errors, loading: false })
    } catch (e) {
      set({ error: String(e), loading: false })
    }
  },

  fetchBreakdown: async (window, dimension) => {
    try {
      set({ breakdown: await bridge().routingObs.breakdown(window, dimension) })
    } catch (e) {
      set({ error: String(e) })
    }
  },

  searchFirst: async (window, filter) => {
    set({ searching: true, error: null })
    try {
      const page = await bridge().routingObs.search(window, filter, undefined, SEARCH_PAGE)
      set({
        rows: page.rows,
        cursor: page.nextCursor,
        hasMore: page.nextCursor != null,
        searching: false,
      })
    } catch (e) {
      set({ error: String(e), searching: false })
    }
  },

  searchMore: async (window, filter) => {
    const { cursor, hasMore, searching, rows } = get()
    if (!hasMore || searching || cursor == null) return
    set({ searching: true })
    try {
      const page = await bridge().routingObs.search(window, filter, cursor, SEARCH_PAGE)
      set({
        rows: [...rows, ...page.rows],
        cursor: page.nextCursor,
        hasMore: page.nextCursor != null,
        searching: false,
      })
    } catch (e) {
      set({ error: String(e), searching: false })
    }
  },

  openDetail: (row) => set({ detail: row }),
  closeDetail: () => set({ detail: null }),

  setLive: (on) => set({ live: on }),

  pushLive: (batch) => {
    const { live, rows } = get()
    if (!live || batch.length === 0) return
    // 实时事件未落库、无 db id（用 0 占位）；batch 为时间升序，reverse 使最新在头部。
    const incoming: RoutingObsEventDto[] = batch.map((e) => ({ ...e, id: 0 })).reverse()
    const seen = new Set(incoming.map((r) => r.seq))
    const merged = [...incoming, ...rows.filter((r) => !seen.has(r.seq))].slice(0, LIVE_MAX_ROWS)
    set({ rows: merged })
  },

  clear: async () => {
    try {
      await bridge().routingObs.clear()
      set({
        summary: null,
        trend: [],
        breakdown: [],
        errors: [],
        rows: [],
        cursor: undefined,
        hasMore: false,
        detail: null,
      })
    } catch (e) {
      set({ error: String(e) })
    }
  },
}))
