import { useEffect, useState } from 'react'
import { usageService, activityService } from '@/services/tauri'
import type { FilledTrendPoint, TrendGranularity } from '../utils/trend-fill'
import { fillTrendGaps } from '../utils/trend-fill'

export type TrendRange = '1d' | '7d' | '30d'
export type TrendDimension = 'tokens' | 'tool_calls' | 'sessions' | 'code_lines'

export interface UseTrendSeriesResult {
  points: FilledTrendPoint[]
  total: number
  loading: boolean
}

/**
 * Fetch and gap-fill a trend series for the given range + dimension.
 *
 * Granularity: '1d' → hour buckets; '7d'/'30d' → day buckets.
 * Stale responses from superseded fetches are discarded (anti-race).
 */
export function useTrendSeries(
  range: TrendRange,
  dimension: TrendDimension,
): UseTrendSeriesResult {
  const [points, setPoints] = useState<FilledTrendPoint[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    const granularity: TrendGranularity = range === '1d' ? 'hour' : 'day'

    const fetchData = async () => {
      try {
        let rawPoints: Array<{ date: string; value: number }>

        if (dimension === 'tokens') {
          const data = await usageService.getUsageTrend(range, 'tokens')
          rawPoints = data.map((p) => ({ date: p.date, value: p.totalTokens }))
        } else {
          const data = await activityService.getActivityTrend(range, dimension)
          rawPoints = data.map((p) => ({ date: p.date, value: p.value }))
        }

        if (cancelled) return

        const filled = fillTrendGaps(rawPoints, granularity)
        const sum = filled.reduce((acc, p) => acc + p.value, 0)
        setPoints(filled)
        setTotal(sum)
      } catch {
        if (!cancelled) {
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
  }, [range, dimension])

  return { points, total, loading }
}
