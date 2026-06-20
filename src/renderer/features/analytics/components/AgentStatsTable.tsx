import { useTranslation } from 'react-i18next'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Card, CardContent } from '@/components/ui/card'
import { useAgentBreakdown } from '../hooks/useAgentBreakdown'
import { formatTokens, formatCost, formatNumber, formatPercent } from '../utils/format'
import type { AnalyticsWindowDto } from '@shared/api-types'

interface AgentStatsTableProps {
  window: AnalyticsWindowDto
  onSelectAgent?: (agentId: string) => void
}

export function AgentStatsTable({ window, onSelectAgent }: AgentStatsTableProps) {
  const { t } = useTranslation()
  const { data, loading } = useAgentBreakdown(window)
  const rows = data ?? []

  return (
    <Card className="border border-border/50 bg-card/40">
      <CardContent className="p-4">
        <span className="mb-3 block text-sm font-medium">{t('analytics:agentStats.title')}</span>
        {loading ? (
          <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">{t('common:loading')}</div>
        ) : rows.length === 0 ? (
          <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">{t('analytics:noData')}</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('analytics:agentStats.agent')}</TableHead>
                <TableHead className="text-right">{t('analytics:agentStats.requests')}</TableHead>
                <TableHead className="text-right">{t('analytics:agentStats.tokens')}</TableHead>
                <TableHead className="text-right">{t('analytics:agentStats.cost')}</TableHead>
                <TableHead className="text-right">{t('analytics:agentStats.share')}</TableHead>
                <TableHead className="text-right">{t('analytics:agentStats.cacheHit')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow
                  key={row.agentId}
                  className={onSelectAgent ? 'cursor-pointer hover:bg-muted/50' : ''}
                  onClick={() => onSelectAgent?.(row.agentId)}
                >
                  <TableCell className="font-medium">{row.agentId}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(row.requests)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatTokens(row.totalTokens)}</TableCell>
                  <TableCell className="text-right tabular-nums text-green-500">{formatCost(row.totalCostUsd)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatPercent(row.shareRatio)}</TableCell>
                  <TableCell className="text-right tabular-nums text-emerald-500">{formatPercent(row.cacheHitRate)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
