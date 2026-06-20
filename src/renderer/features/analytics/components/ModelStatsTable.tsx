import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/components/ui/data-table'
import { DataWallCard } from '@/features/dashboard/datawall/DataWallCard'
import { useModelBreakdown } from '../hooks/useModelBreakdown'
import { formatTokens, formatCost, formatNumber, formatPercent } from '../utils/format'
import type { AnalyticsWindowDto, ModelBreakdownDto } from '@shared/api-types'

interface ModelStatsTableProps {
  window: AnalyticsWindowDto
  agentId?: string
}

export function ModelStatsTable({ window, agentId }: ModelStatsTableProps) {
  const { t } = useTranslation('analytics')
  const { data, loading } = useModelBreakdown(window, agentId)
  const rows = data ?? []

  const columns = useMemo<ColumnDef<ModelBreakdownDto>[]>(
    () => [
      {
        header: () => t('modelStats.model'),
        accessorKey: 'model',
        cell: ({ row }) => <span className="font-medium">{row.original.model}</span>,
      },
      {
        header: () => <span className="block text-right">{t('modelStats.requests')}</span>,
        accessorKey: 'requests',
        cell: ({ row }) => <span className="block text-right tabular-nums">{formatNumber(row.original.requests)}</span>,
      },
      {
        header: () => <span className="block text-right">{t('modelStats.tokens')}</span>,
        accessorKey: 'totalTokens',
        cell: ({ row }) => <span className="block text-right tabular-nums">{formatTokens(row.original.totalTokens)}</span>,
      },
      {
        header: () => <span className="block text-right">{t('modelStats.cost')}</span>,
        accessorKey: 'totalCostUsd',
        cell: ({ row }) => <span className="block text-right tabular-nums text-emerald-500">{formatCost(row.original.totalCostUsd)}</span>,
      },
      {
        header: () => <span className="block text-right">{t('modelStats.avgCost')}</span>,
        accessorKey: 'avgCostUsd',
        cell: ({ row }) => <span className="block text-right tabular-nums">{formatCost(row.original.avgCostUsd)}</span>,
      },
      {
        header: () => <span className="block text-right">{t('modelStats.share')}</span>,
        accessorKey: 'shareRatio',
        cell: ({ row }) => <span className="block text-right tabular-nums">{formatPercent(row.original.shareRatio)}</span>,
      },
    ],
    [t],
  )

  return (
    <DataWallCard title={t('modelStats.title')} className="h-full">
      {loading && !data ? (
        <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">{t('loading', { ns: 'common' })}</div>
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          getRowId={(r) => r.model}
          emptyState={<span className="text-sm text-muted-foreground">{t('noData')}</span>}
        />
      )}
    </DataWallCard>
  )
}
