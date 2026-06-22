import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/components/ui/data-table'
import { DataWallCard } from '@/features/dashboard/datawall/DataWallCard'
import { useAgentBreakdown } from '../hooks/useAgentBreakdown'
import { formatTokens, formatCost, formatNumber, formatPercent } from '../utils/format'
import type { AnalyticsWindowDto, AgentBreakdownDto } from '@shared/api-types'

interface AgentStatsTableProps {
  window: AnalyticsWindowDto
  onSelectAgent?: (agentId: string) => void
}

export function AgentStatsTable({ window, onSelectAgent }: AgentStatsTableProps) {
  const { t } = useTranslation('analytics')
  const { data, loading } = useAgentBreakdown(window)
  const rows = data ?? []

  const columns = useMemo<ColumnDef<AgentBreakdownDto>[]>(
    () => [
      {
        header: () => t('agentStats.agent'),
        accessorKey: 'agentId',
        cell: ({ row }) => <span className="font-medium">{row.original.agentId}</span>,
      },
      {
        header: () => <span className="block text-right">{t('agentStats.requests')}</span>,
        accessorKey: 'requests',
        cell: ({ row }) => <span className="block text-right tabular-nums">{formatNumber(row.original.requests)}</span>,
      },
      {
        header: () => <span className="block text-right">{t('agentStats.tokens')}</span>,
        accessorKey: 'totalTokens',
        cell: ({ row }) => <span className="block text-right tabular-nums">{formatTokens(row.original.totalTokens)}</span>,
      },
      {
        header: () => <span className="block text-right">{t('agentStats.cost')}</span>,
        accessorKey: 'totalCostUsd',
        cell: ({ row }) => <span className="block text-right tabular-nums text-emerald-500">{formatCost(row.original.totalCostUsd)}</span>,
      },
      {
        header: () => <span className="block text-right">{t('agentStats.share')}</span>,
        accessorKey: 'shareRatio',
        cell: ({ row }) => <span className="block text-right tabular-nums">{formatPercent(row.original.shareRatio)}</span>,
      },
      {
        header: () => <span className="block text-right">{t('agentStats.cacheHit')}</span>,
        accessorKey: 'cacheHitRate',
        cell: ({ row }) => <span className="block text-right tabular-nums text-violet-500">{formatPercent(row.original.cacheHitRate)}</span>,
      },
    ],
    [t],
  )

  return (
    <DataWallCard title={t('agentStats.title')} className="h-full">
      {loading && !data ? (
        <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">{t('loading', { ns: 'common' })}</div>
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          getRowId={(r) => r.agentId}
          rowProps={onSelectAgent ? (row) => ({ className: 'cursor-pointer hover:bg-muted/50', onDoubleClick: () => onSelectAgent(row.original.agentId) }) : undefined}
          emptyState={<span className="text-sm text-muted-foreground">{t('noData')}</span>}
        />
      )}
    </DataWallCard>
  )
}
