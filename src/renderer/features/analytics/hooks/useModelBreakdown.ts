import { useMemo } from 'react'
import { bridge } from '@/services/bridge'
import { useAnalyticsData } from './useAnalyticsData'
import type { AnalyticsWindowDto, ModelBreakdownDto } from '@shared/api-types'

export function useModelBreakdown(window: AnalyticsWindowDto, agentId?: string) {
  const fetcher = useMemo(() => () => bridge().analytics.modelBreakdown(window, agentId), [window, agentId])
  return useAnalyticsData<ModelBreakdownDto[]>(fetcher, [window, agentId])
}
