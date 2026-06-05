import { useEffect, useState } from 'react'
import { usageService, activityService } from '@/services/tauri'
import type { FilledTrendPoint, TrendGranularity } from '../utils/trend-fill'
import { fillTrendGaps } from '../utils/trend-fill'

export type TrendRange = '1d' | '7d' | '30d'
export type TrendDimension = 'tokens' | 'tool_calls' | 'sessions' | 'code_lines' | 'cost'

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
 *
 * Optional `refreshNonce` — increment it externally to trigger a re-fetch
 * without changing range or dimension.
 */
export function useTrendSeries(
  range: TrendRange,
  dimension: TrendDimension,
  refreshNonce?: number,
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
        let rawPoints: Array<{ date: string; value: number; extra?: Record<string, number> }>

        if (dimension === 'tokens') {
          const data = await usageService.getUsageTrend(range, 'tokens')
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
          // 费用维度：取后端按模型定价算出的每日 costUsd（美元）。
          const data = await usageService.getUsageTrend(range, 'cost')
          rawPoints = data.map((p) => ({ date: p.date, value: p.costUsd ?? 0 }))
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
    // refreshNonce intentionally included so callers can force a re-fetch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, dimension, refreshNonce])

  return { points, total, loading }
}
