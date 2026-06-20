import { useEffect, useRef, useState } from 'react'
import { activityService } from '@/services/tauri'
import { bridge } from '@/services/bridge'
import type { AnalyticsSummaryDto } from '@shared/api-types'
import type { FilledTrendPoint } from '../utils/trend-fill'
import { fillTrendGaps } from '../utils/trend-fill'
import type { TimeRange } from '../utils/time-range'
import { granularityFor, toWindow } from '../utils/time-range'
import type { DailyPoint } from '../utils/activity-stats'

/** 跳变守卫：新值与旧值 JSON 相同则保留旧引用 → React bail out，零重渲染、零闪动。 */
function keepIfSame<T>(prev: T, next: T): T {
  return JSON.stringify(prev) === JSON.stringify(next) ? prev : next
}

/** 趋势维度：activity=活跃热力图（近一年，独立取数），其余为数值曲线。 */
export type TrendDimension = 'activity' | 'tokens' | 'cost' | 'tool_calls' | 'sessions' | 'code_lines'

export interface UseTrendSeriesResult {
  points: FilledTrendPoint[]
  total: number
  loading: boolean
}

/**
 * 数值维度趋势：按 range 取数并补齐空桶。
 * granularity 自动：范围 ≤48h 小时桶，更长日桶。
 * `enabled=false`（活跃维度选中时）跳过取数。
 * Stale responses from superseded fetches are discarded (anti-race).
 *
 * 软刷新：仅 refreshNonce 变化（查询身份 range+dimension 不变）时静默重拉——
 * 不进骨架屏、失败保留旧数据、新数据与旧数据相同则零重渲染，避免整卡跳动。
 */
export function useTrendSeries(
  range: TimeRange,
  dimension: TrendDimension,
  enabled: boolean,
  refreshNonce?: number,
): UseTrendSeriesResult {
  const [points, setPoints] = useState<FilledTrendPoint[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const queryKeyRef = useRef('')

  useEffect(() => {
    if (!enabled || dimension === 'activity') return
    let cancelled = false
    const queryKey = `${range.startMs}:${range.endMs}:${dimension}`
    const soft = queryKeyRef.current === queryKey
    queryKeyRef.current = queryKey
    if (!soft) setLoading(true)

    const granularity = granularityFor(range)
    const window = toWindow(range)

    const fetchData = async () => {
      try {
        let rawPoints: Array<{ date: string; value: number; extra?: Record<string, number> }>

        if (dimension === 'tokens') {
          const data = await bridge().analytics.trend(window, granularity, 'tokens')
          // Use the four-way sum (input + output + cacheCreation + cacheRead) so
          // cache tokens are included, and carry per-category breakdown as extra.
          rawPoints = data.map((p) => ({
            date: p.date,
            value: p.inputTokens + p.outputTokens + p.cacheCreationTokens + p.cacheReadTokens,
            extra: {
              input: p.inputTokens,
              output: p.outputTokens,
              cacheCreation: p.cacheCreationTokens,
              cacheRead: p.cacheReadTokens,
            },
          }))
        } else if (dimension === 'cost') {
          // 费用维度：取后端按模型定价算出的每桶 costUsd（美元）。
          const data = await bridge().analytics.trend(window, granularity, 'cost')
          rawPoints = data.map((p) => ({ date: p.date, value: p.costUsd ?? 0 }))
        } else {
          const data = await activityService.getActivityTrend(window, granularity, dimension)
          rawPoints = data.map((p) => ({ date: p.date, value: p.value }))
        }

        if (cancelled) return

        const filled = fillTrendGaps(rawPoints, granularity)
        const sum = filled.reduce((acc, p) => acc + p.value, 0)
        setPoints((prev) => keepIfSame(prev, filled))
        setTotal(sum)
      } catch {
        // 软刷新失败保留旧数据（避免曲线闪空）；硬加载失败如实清空。
        if (!cancelled && !soft) {
          setPoints([])
          setTotal(0)
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void fetchData()

    return () => {
      cancelled = true
    }
    // refreshNonce intentionally included so callers can force a re-fetch
  }, [range, dimension, enabled, refreshNonce])

  return { points, total, loading }
}

const YEAR_MS = 365 * 86_400_000

/** 活跃热力图数据：近一年 sessions 日桶（独立于时间选择器）。 */
export function useActivityHeatmapData(
  enabled: boolean,
  refreshNonce?: number,
): { points: DailyPoint[]; loading: boolean } {
  const [points, setPoints] = useState<DailyPoint[]>([])
  const [loading, setLoading] = useState(false)
  const loadedRef = useRef(false)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    // 软刷新：首拉之后的 nonce 重拉静默进行（不进骨架、失败保留旧数据、相同零重渲染）。
    const soft = loadedRef.current
    if (!soft) setLoading(true)
    const now = Date.now()
    activityService
      .getActivityTrend(
        { startSec: Math.floor((now - YEAR_MS) / 1000), endSec: Math.floor(now / 1000) },
        'day',
        'sessions',
      )
      .then((data) => {
        if (cancelled) return
        loadedRef.current = true
        setPoints((prev) => keepIfSame(prev, data.map((p) => ({ date: p.date, value: p.value }))))
      })
      .catch(() => {
        if (!cancelled && !soft) setPoints([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [enabled, refreshNonce])

  return { points, loading }
}

/** 范围内用量汇总（Token/费用统计行 + 最后同步时间）。 */
export function useUsageSummaryRange(
  range: TimeRange,
  refreshNonce?: number,
): { summary: AnalyticsSummaryDto | null } {
  const [summary, setSummary] = useState<AnalyticsSummaryDto | null>(null)
  const queryKeyRef = useRef('')

  useEffect(() => {
    let cancelled = false
    const queryKey = `${range.startMs}:${range.endMs}`
    const soft = queryKeyRef.current === queryKey
    queryKeyRef.current = queryKey
    bridge()
      .analytics.summary(toWindow(range))
      .then((data) => {
        if (!cancelled) setSummary((prev) => keepIfSame<AnalyticsSummaryDto | null>(prev, data))
      })
      .catch(() => {
        // 软刷新失败保留旧汇总（统计行不闪「—」）；范围切换失败如实置空。
        if (!cancelled && !soft) setSummary(null)
      })
    return () => {
      cancelled = true
    }
  }, [range, refreshNonce])

  return { summary }
}
