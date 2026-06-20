import { useTranslation } from 'react-i18next'
import { Card, CardContent } from '@/components/ui/card'
import { Activity, DollarSign, Zap, Database } from 'lucide-react'
import { useAnalyticsSummary } from '../hooks/useAnalyticsSummary'
import { formatTokens, formatCost, formatNumber, formatPercent } from '../utils/format'
import type { AnalyticsWindowDto } from '@shared/api-types'

interface AnalyticsHeroProps {
  window: AnalyticsWindowDto
  agentId?: string
}

export function AnalyticsHero({ window, agentId }: AnalyticsHeroProps) {
  const { t } = useTranslation()
  const { data, loading } = useAnalyticsSummary(window, agentId)

  if (loading) {
    return (
      <Card className="border border-border/50 bg-card/40">
        <CardContent className="flex h-[120px] items-center justify-center">
          <span className="text-sm text-muted-foreground">{t('common:loading')}</span>
        </CardContent>
      </Card>
    )
  }

  const summary = data ?? {
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
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Card className="border border-border/50 bg-card/40">
        <CardContent className="flex flex-col gap-1 p-4">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Zap className="h-3.5 w-3.5 text-primary" />
            {t('analytics:kpi.totalTokens')}
          </div>
          <span className="text-xl font-bold tabular-nums">{formatTokens(summary.totalTokens)}</span>
        </CardContent>
      </Card>
      <Card className="border border-border/50 bg-card/40">
        <CardContent className="flex flex-col gap-1 p-4">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <DollarSign className="h-3.5 w-3.5 text-green-500" />
            {t('analytics:kpi.totalCost')}
          </div>
          <span className="text-xl font-bold tabular-nums text-green-500">{formatCost(summary.totalCostUsd)}</span>
        </CardContent>
      </Card>
      <Card className="border border-border/50 bg-card/40">
        <CardContent className="flex flex-col gap-1 p-4">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Activity className="h-3.5 w-3.5 text-blue-500" />
            {t('analytics:kpi.requests')}
          </div>
          <span className="text-xl font-bold tabular-nums">{formatNumber(summary.requests)}</span>
        </CardContent>
      </Card>
      <Card className="border border-border/50 bg-card/40">
        <CardContent className="flex flex-col gap-1 p-4">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Database className="h-3.5 w-3.5 text-emerald-500" />
            {t('analytics:kpi.cacheHitRate')}
          </div>
          <span className="text-xl font-bold tabular-nums text-emerald-500">{formatPercent(summary.cacheHitRate)}</span>
        </CardContent>
      </Card>
    </div>
  )
}
