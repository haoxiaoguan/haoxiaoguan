import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Card, CardContent } from '@/components/ui/card'
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
  const { t } = useTranslation()
  const [cursor, setCursor] = useState<{ occurredAt: number; id: number } | undefined>(undefined)
  const [selectedRow, setSelectedRow] = useState<UsageEventRowDto | null>(null)

  const filter: UsageEventSearchFilterDto = agentId ? { agentId } : {}
  const { data, loading } = useUsageEvents(window, filter, cursor, 20)
  const rows = data?.rows ?? []
  const nextCursor = data?.nextCursor

  return (
    <Card className="border border-border/50 bg-card/40">
      <CardContent className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-medium">{t('analytics:requestLog.title')}</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={!cursor || loading} onClick={() => setCursor(undefined)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" disabled={!nextCursor || loading} onClick={() => nextCursor && setCursor(nextCursor)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
        {loading ? (
          <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">{t('common:loading')}</div>
        ) : rows.length === 0 ? (
          <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">{t('analytics:noData')}</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('analytics:requestLog.time')}</TableHead>
                <TableHead>{t('analytics:requestLog.agent')}</TableHead>
                <TableHead>{t('analytics:requestLog.model')}</TableHead>
                <TableHead>{t('analytics:requestLog.source')}</TableHead>
                <TableHead className="text-right">{t('analytics:requestLog.tokens')}</TableHead>
                <TableHead className="text-right">{t('analytics:requestLog.cost')}</TableHead>
                <TableHead className="text-right">{t('analytics:requestLog.status')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelectedRow(row)}>
                  <TableCell className="text-xs tabular-nums">{new Date(row.occurredAt * 1000).toLocaleString()}</TableCell>
                  <TableCell className="text-xs">{row.agentId}</TableCell>
                  <TableCell className="text-xs">{row.model ?? '—'}</TableCell>
                  <TableCell className="text-xs">{row.source}</TableCell>
                  <TableCell className="text-right text-xs tabular-nums">{formatTokens(row.inputTokens + row.outputTokens)}</TableCell>
                  <TableCell className="text-right text-xs tabular-nums text-green-500">{formatCost(row.totalCostUsd)}</TableCell>
                  <TableCell className="text-right text-xs tabular-nums">{row.status ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {selectedRow && <RequestDetailDialog row={selectedRow} onClose={() => setSelectedRow(null)} />}
    </Card>
  )
}
