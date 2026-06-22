import { useMemo } from 'react'
import { bridge } from '@/services/bridge'
import { useAnalyticsData } from './useAnalyticsData'
import type { AnalyticsTrendPointDto, AnalyticsWindowDto } from '@shared/api-types'

export function useAnalyticsTrend(
  window: AnalyticsWindowDto,
  granularity: 'hour' | 'day',
  metric: 'tokens' | 'cost' | 'requests',
  agentId?: string,
) {
  const fetcher = useMemo(
    () => () => bridge().analytics.trend(window, granularity, metric, agentId),
    [window, granularity, metric, agentId],
  )
  return useAnalyticsData<AnalyticsTrendPointDto[]>(fetcher, [window, granularity, metric, agentId])
}
