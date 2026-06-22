import { useMemo } from 'react'
import { bridge } from '@/services/bridge'
import { useAnalyticsData } from './useAnalyticsData'
import type { AgentBreakdownDto, AnalyticsWindowDto } from '@shared/api-types'

export function useAgentBreakdown(window: AnalyticsWindowDto) {
  const fetcher = useMemo(() => () => bridge().analytics.agentBreakdown(window), [window])
  return useAnalyticsData<AgentBreakdownDto[]>(fetcher, [window])
}
