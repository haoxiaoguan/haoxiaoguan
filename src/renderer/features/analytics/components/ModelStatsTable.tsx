import { useTranslation } from 'react-i18next'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Card, CardContent } from '@/components/ui/card'
import { useModelBreakdown } from '../hooks/useModelBreakdown'
import { formatTokens, formatCost, formatNumber, formatPercent } from '../utils/format'
import type { AnalyticsWindowDto } from '@shared/api-types'

interface ModelStatsTableProps {
  window: AnalyticsWindowDto
  agentId?: string
}

export function ModelStatsTable({ window, agentId }: ModelStatsTableProps) {
  const { t } = useTranslation()
  const { data, loading } = useModelBreakdown(window, agentId)
  const rows = data ?? []

  return (
    <Card className="border border-border/50 bg-card/40">
      <CardContent className="p-4">
        <span className="mb-3 block text-sm font-medium">{t('analytics:modelStats.title')}</span>
        {loading ? (
          <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">{t('common:loading')}</div>
        ) : rows.length === 0 ? (
          <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">{t('analytics:noData')}</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('analytics:modelStats.model')}</TableHead>
                <TableHead className="text-right">{t('analytics:modelStats.requests')}</TableHead>
                <TableHead className="text-right">{t('analytics:modelStats.tokens')}</TableHead>
                <TableHead className="text-right">{t('analytics:modelStats.cost')}</TableHead>
                <TableHead className="text-right">{t('analytics:modelStats.avgCost')}</TableHead>
                <TableHead className="text-right">{t('analytics:modelStats.share')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.model}>
                  <TableCell className="font-medium">{row.model}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(row.requests)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatTokens(row.totalTokens)}</TableCell>
                  <TableCell className="text-right tabular-nums text-green-500">{formatCost(row.totalCostUsd)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCost(row.avgCostUsd)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatPercent(row.shareRatio)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
