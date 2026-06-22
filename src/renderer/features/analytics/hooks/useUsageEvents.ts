import { useMemo } from 'react'
import { bridge } from '@/services/bridge'
import { useAnalyticsData } from './useAnalyticsData'
import type { AnalyticsWindowDto, UsageEventSearchFilterDto, UsageEventSearchPageDto } from '@shared/api-types'

export function useUsageEvents(
  window: AnalyticsWindowDto,
  filter: UsageEventSearchFilterDto,
  cursor?: { occurredAt: number; requestId: string },
  limit?: number,
) {
  const fetcher = useMemo(
    () => () => bridge().analytics.search(window, filter, cursor, limit),
    [window, filter, cursor, limit],
  )
  return useAnalyticsData<UsageEventSearchPageDto>(fetcher, [window, filter, cursor, limit])
}
