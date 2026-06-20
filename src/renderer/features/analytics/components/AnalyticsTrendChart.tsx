import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts'
import { Card, CardContent } from '@/components/ui/card'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useAnalyticsTrend } from '../hooks/useAnalyticsTrend'
import { formatTokens, formatCost } from '../utils/format'
import type { AnalyticsWindowDto } from '@shared/api-types'

type Metric = 'tokens' | 'cost' | 'requests'

interface AnalyticsTrendChartProps {
  window: AnalyticsWindowDto
  agentId?: string
}

export function AnalyticsTrendChart({ window, agentId }: AnalyticsTrendChartProps) {
  const { t } = useTranslation()
  const [metric, setMetric] = useState<Metric>('tokens')
  const granularity: 'hour' | 'day' = window.endSec - window.startSec <= 172800 ? 'hour' : 'day'
  const { data, loading } = useAnalyticsTrend(window, granularity, metric, agentId)

  const points = data ?? []
  const formatValue = (v: number) => {
    if (metric === 'cost') return formatCost(v)
    if (metric === 'requests') return v.toString()
    return formatTokens(v)
  }

  return (
    <Card className="border border-border/50 bg-card/40">
      <CardContent className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-medium">{t('analytics:trend.title')}</span>
          <ToggleGroup type="single" value={metric} onValueChange={(v) => { if (v) setMetric(v as Metric) }}>
            <ToggleGroupItem value="tokens" className="text-xs">{t('analytics:trend.tokens')}</ToggleGroupItem>
            <ToggleGroupItem value="cost" className="text-xs">{t('analytics:trend.cost')}</ToggleGroupItem>
            <ToggleGroupItem value="requests" className="text-xs">{t('analytics:trend.requests')}</ToggleGroupItem>
          </ToggleGroup>
        </div>
        {loading ? (
          <div className="flex h-[280px] items-center justify-center text-sm text-muted-foreground">{t('common:loading')}</div>
        ) : points.length === 0 ? (
          <div className="flex h-[280px] items-center justify-center text-sm text-muted-foreground">{t('analytics:noData')}</div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={points}>
              <defs>
                <linearGradient id="trendGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} className="text-muted-foreground" />
              <YAxis tickFormatter={formatValue} tick={{ fontSize: 11 }} className="text-muted-foreground" width={60} />
              <Tooltip
                formatter={(v) => formatValue(Number(v))}
                contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '12px' }}
              />
              <Area
                type="monotone"
                dataKey={metric === 'cost' ? 'costUsd' : metric === 'requests' ? 'requests' : 'totalTokens'}
                stroke="hsl(var(--primary))"
                fill="url(#trendGradient)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}
