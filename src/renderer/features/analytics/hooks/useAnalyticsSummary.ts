import { useMemo } from 'react'
import { bridge } from '@/services/bridge'
import { useAnalyticsData } from './useAnalyticsData'
import type { AnalyticsSummaryDto, AnalyticsWindowDto } from '@shared/api-types'

export function useAnalyticsSummary(window: AnalyticsWindowDto, agentId?: string) {
  const fetcher = useMemo(() => () => bridge().analytics.summary(window, agentId), [window, agentId])
  return useAnalyticsData<AnalyticsSummaryDto>(fetcher, [window, agentId])
}
