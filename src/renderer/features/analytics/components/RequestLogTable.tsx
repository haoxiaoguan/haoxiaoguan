import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/components/ui/data-table'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useUsageEvents } from '../hooks/useUsageEvents'
import { useModelBreakdown } from '../hooks/useModelBreakdown'
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
  const [modelFilter, setModelFilter] = useState<string>('all')

  // 从模型统计拿可选模型列表（与当前 agent 筛选联动）
  const { data: modelRows } = useModelBreakdown(window, agentId)
  const modelOptions = useMemo(() => {
    const models = (modelRows ?? []).map((r) => r.model).filter((m) => m && m !== '—')
    return [...new Set(models)].sort()
  }, [modelRows])

  const filter: UsageEventSearchFilterDto = useMemo(
    () => ({
      ...(agentId ? { agentId } : {}),
      ...(modelFilter !== 'all' ? { model: modelFilter } : {}),
    }),
    [agentId, modelFilter],
  )
  const { data, loading } = useUsageEvents(window, filter, cursor, 20)
  const rows = data?.rows ?? []
  const nextCursor = data?.nextCursor

  // filter 变化时重置分页游标
  const filterKey = `${agentId ?? 'all'}:${modelFilter}`
  const lastFilterKey = useMemo(() => filterKey, [filterKey])
  if (cursor && lastFilterKey !== filterKey) {
    setCursor(undefined)
  }

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
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* 筛选栏 */}
      <div className="flex items-center gap-2">
        <Select value={modelFilter} onValueChange={setModelFilter}>
          <SelectTrigger className="h-8 w-[180px] rounded-[8px] bg-card text-[12px]">
            <SelectValue placeholder={t('requestLog.modelFilter')} />
          </SelectTrigger>
          <SelectContent align="start">
            <SelectItem value="all">{t('requestLog.allModels')}</SelectItem>
            {modelOptions.map((m) => (
              <SelectItem key={m} value={m}>{m}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* 表格占满剩余空间 */}
      <div className="min-h-0 flex-1">
        {loading && !data ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{t('loading', { ns: 'common' })}</div>
        ) : (
          <DataTable
            columns={columns}
            data={rows}
            getRowId={(r) => String(r.id)}
            className="h-full"
            rowProps={(row) => ({ className: 'cursor-pointer hover:bg-muted/50', onDoubleClick: () => setSelectedRow(row.original) })}
            emptyState={<span className="text-sm text-muted-foreground">{t('noData')}</span>}
          />
        )}
      </div>

      {/* 分页 */}
      {rows.length > 0 && (
        <div className="flex items-center justify-end gap-1 py-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" disabled={!cursor || loading} onClick={() => setCursor(undefined)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" disabled={!nextCursor || loading} onClick={() => nextCursor && setCursor(nextCursor)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      {selectedRow && <RequestDetailDialog row={selectedRow} onClose={() => setSelectedRow(null)} />}
    </div>
  )
}
