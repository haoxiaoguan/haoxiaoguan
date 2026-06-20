import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts'
import { SegmentedOptions } from '@/components/ui/segmented-options'
import { DataWallCard } from '@/features/dashboard/datawall/DataWallCard'
import { useAnalyticsTrend } from '../hooks/useAnalyticsTrend'
import { granularityFor, type TimeRange } from '@/features/dashboard/utils/time-range'
import { VIZ } from '@/features/dashboard/datawall/viz-colors'
import { formatTokens, formatCost } from '../utils/format'
import type { AnalyticsWindowDto } from '@shared/api-types'

type Metric = 'tokens' | 'cost' | 'requests'

interface AnalyticsTrendChartProps {
  window: AnalyticsWindowDto
  agentId?: string
}

export function AnalyticsTrendChart({ window, agentId }: AnalyticsTrendChartProps) {
  const { t } = useTranslation('analytics')
  const [metric, setMetric] = useState<Metric>('tokens')
  const granularity = useMemo(
    () => granularityFor({ startMs: window.startSec * 1000, endMs: window.endSec * 1000 } as TimeRange),
    [window],
  )
  const { data, loading } = useAnalyticsTrend(window, granularity, metric, agentId)

  const points = data ?? []
  const formatValue = (v: number) => {
    if (metric === 'cost') return formatCost(v)
    if (metric === 'requests') return v.toString()
    return formatTokens(v)
  }

  const metricItems = useMemo(
    () => [
      { value: 'tokens', label: t('trend.tokens') },
      { value: 'cost', label: t('trend.cost') },
      { value: 'requests', label: t('trend.requests') },
    ],
    [t],
  )

  const dataKey = metric === 'cost' ? 'costUsd' : metric === 'requests' ? 'requests' : 'totalTokens'

  return (
    <DataWallCard
      title={t('trend.title')}
      headerRight={
        <SegmentedOptions items={metricItems} value={metric} onChange={(v) => setMetric(v as Metric)} />
      }
    >
      {loading && !data ? (
        <div className="flex h-[280px] items-center justify-center text-sm text-muted-foreground">
          {t('loading', { ns: 'common' })}
        </div>
      ) : points.length === 0 ? (
        <div className="flex h-[280px] items-center justify-center text-sm text-muted-foreground">
          {t('noData')}
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={points}>
            <defs>
              <linearGradient id="analyticsTrend" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={VIZ.blue} stopOpacity={0.3} />
                <stop offset="95%" stopColor={VIZ.blue} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} className="text-muted-foreground" />
            <YAxis tickFormatter={formatValue} tick={{ fontSize: 11 }} className="text-muted-foreground" width={60} />
            <Tooltip
              formatter={(v) => formatValue(Number(v))}
              contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '12px' }}
            />
            <Area type="monotone" dataKey={dataKey} stroke={VIZ.blue} fill="url(#analyticsTrend)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </DataWallCard>
  )
}
