import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { useAnalyticsSummary } from '../hooks/useAnalyticsSummary'
import { formatTokens, formatCost, formatNumber, formatPercent } from '../utils/format'
import type { AnalyticsWindowDto } from '@shared/api-types'

interface AnalyticsHeroProps {
  window: AnalyticsWindowDto
  agentId?: string
}

interface KpiCellProps {
  accent: string
  gradient: string
  label: string
  value: string
  hint: string
}

function KpiCell({ accent, gradient, label, value, hint }: KpiCellProps) {
  return (
    <div
      className={cn(
        'relative min-w-0 overflow-hidden rounded-[14px] border border-border bg-card px-5 py-4 shadow-bento-light dark:shadow-bento',
        gradient,
      )}
    >
      <span className={cn('absolute left-5 top-0 h-[3px] w-10 rounded-b-full', accent)} aria-hidden />
      <p className="truncate text-[11px] font-medium leading-4 text-muted-foreground">{label}</p>
      <p
        className="mt-1 truncate text-[26px] font-extrabold leading-8 tracking-tight text-foreground"
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {value}
      </p>
      <p className="mt-1 truncate text-[12px] leading-4 text-muted-foreground">{hint}</p>
    </div>
  )
}

export function AnalyticsHero({ window, agentId }: AnalyticsHeroProps) {
  const { t } = useTranslation('analytics')
  const { data, loading } = useAnalyticsSummary(window, agentId)

  if (loading && !data) {
    return (
      <div className="grid grid-cols-4 gap-2.5">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-[88px] animate-pulse rounded-[14px] border border-border bg-card" />
        ))}
      </div>
    )
  }

  const s = data ?? {
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    requests: 0,
    totalCostUsd: 0,
    cacheHitRate: 0,
  }

  return (
    <div className="grid grid-cols-4 gap-2.5">
      <KpiCell
        accent="bg-blue-500"
        gradient="bg-gradient-to-br from-blue-500/[0.09] to-transparent"
        label={t('kpi.totalTokens')}
        value={formatTokens(s.totalTokens)}
        hint={t('kpi.tokensHint', { input: formatTokens(s.inputTokens), output: formatTokens(s.outputTokens) })}
      />
      <KpiCell
        accent="bg-emerald-500"
        gradient="bg-gradient-to-br from-emerald-500/[0.09] to-transparent"
        label={t('kpi.totalCost')}
        value={formatCost(s.totalCostUsd)}
        hint={t('kpi.costHint')}
      />
      <KpiCell
        accent="bg-orange-400"
        gradient="bg-gradient-to-br from-orange-400/[0.09] to-transparent"
        label={t('kpi.requests')}
        value={formatNumber(s.requests)}
        hint={t('kpi.requestsHint')}
      />
      <KpiCell
        accent="bg-violet-500"
        gradient="bg-gradient-to-br from-violet-500/[0.09] to-transparent"
        label={t('kpi.cacheHitRate')}
        value={formatPercent(s.cacheHitRate)}
        hint={t('kpi.cacheHint', { read: formatTokens(s.cacheReadTokens) })}
      />
    </div>
  )
}
