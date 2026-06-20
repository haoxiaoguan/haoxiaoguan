import { useMemo, useCallback } from 'react'
import { bridge } from '@/services/bridge'
import { useAnalyticsData } from './useAnalyticsData'
import type { ModelPricingDto, PricingConfigDto } from '@shared/api-types'

export function useModelPricing() {
  const fetcher = useMemo(() => () => bridge().analytics.listPricing(), [])
  return useAnalyticsData<ModelPricingDto[]>(fetcher, [])
}

export function useUpsertPricing() {
  return useCallback((row: ModelPricingDto) => bridge().analytics.upsertPricing(row), [])
}

export function useDeletePricing() {
  return useCallback((modelId: string) => bridge().analytics.deletePricing(modelId), [])
}

export function usePricingConfig(agentId: string) {
  const fetcher = useMemo(() => () => bridge().analytics.getPricingConfig(agentId), [agentId])
  return useAnalyticsData<PricingConfigDto>(fetcher, [agentId])
}

export function useSetPricingConfig() {
  return useCallback(
    (agentId: string, multiplier: number, source: 'request' | 'response') =>
      bridge().analytics.setPricingConfig(agentId, multiplier, source),
    [],
  )
}
