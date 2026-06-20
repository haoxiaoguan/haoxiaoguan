import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/components/ui/data-table'
import { DataWallCard } from '@/features/dashboard/datawall/DataWallCard'
import { Button } from '@/components/ui/button'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useUsageEvents } from '../hooks/useUsageEvents'
import { formatTokens, formatCost } from '../utils/format'
import { RequestDetailDialog } from './RequestDetailDialog'
import type { AnalyticsWindowDto, UsageEventSearchFilterDto, UsageEventRowDto } from '@shared/api-types'

interface RequestLogTableProps {
  window: AnalyticsWindowDto
  agentId?: string
}

export function RequestLogTable({ window, agentId }: RequestLogTableProps) {
  const { t } = useTranslation('analytics')
  const [cursor, setCursor] = useState<{ occurredAt: number; id: number } | undefined>(undefined)
  const [selectedRow, setSelectedRow] = useState<UsageEventRowDto | null>(null)

  const filter: UsageEventSearchFilterDto = useMemo(() => (agentId ? { agentId } : {}), [agentId])
  const { data, loading } = useUsageEvents(window, filter, cursor, 20)
  const rows = data?.rows ?? []
  const nextCursor = data?.nextCursor

  const columns = useMemo<ColumnDef<UsageEventRowDto>[]>(
    () => [
      {
        header: () => t('requestLog.time'),
        accessorKey: 'occurredAt',
        cell: ({ row }) => (
          <span className="text-xs tabular-nums">{new Date(row.original.occurredAt * 1000).toLocaleString()}</span>
        ),
      },
      {
        header: () => t('requestLog.agent'),
        accessorKey: 'agentId',
        cell: ({ row }) => <span className="text-xs">{row.original.agentId}</span>,
      },
      {
        header: () => t('requestLog.model'),
        accessorKey: 'model',
        cell: ({ row }) => <span className="text-xs">{row.original.model ?? '—'}</span>,
      },
      {
        header: () => t('requestLog.source'),
        accessorKey: 'source',
        cell: ({ row }) => <span className="text-xs">{row.original.source}</span>,
      },
      {
        header: () => <span className="block text-right">{t('requestLog.tokens')}</span>,
        id: 'tokens',
        cell: ({ row }) => (
          <span className="block text-right text-xs tabular-nums">
            {formatTokens(row.original.inputTokens + row.original.outputTokens)}
          </span>
        ),
      },
      {
        header: () => <span className="block text-right">{t('requestLog.cost')}</span>,
        accessorKey: 'totalCostUsd',
        cell: ({ row }) => (
          <span className="block text-right text-xs tabular-nums text-emerald-500">{formatCost(row.original.totalCostUsd)}</span>
        ),
      },
      {
        header: () => <span className="block text-right">{t('requestLog.status')}</span>,
        accessorKey: 'status',
        cell: ({ row }) => <span className="block text-right text-xs tabular-nums">{row.original.status ?? '—'}</span>,
      },
    ],
    [t],
  )

  return (
    <DataWallCard
      title={t('requestLog.title')}
      className="h-full"
      headerRight={
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" disabled={!cursor || loading} onClick={() => setCursor(undefined)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" disabled={!nextCursor || loading} onClick={() => nextCursor && setCursor(nextCursor)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      }
    >
      {loading && !data ? (
        <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">{t('loading', { ns: 'common' })}</div>
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          getRowId={(r) => String(r.id)}
          rowProps={(row) => ({ className: 'cursor-pointer hover:bg-muted/50', onDoubleClick: () => setSelectedRow(row.original) })}
          emptyState={<span className="text-sm text-muted-foreground">{t('noData')}</span>}
        />
      )}
      {selectedRow && <RequestDetailDialog row={selectedRow} onClose={() => setSelectedRow(null)} />}
    </DataWallCard>
  )
}
