import { useState, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/components/ui/data-table'
import { DataWallCard } from '@/features/dashboard/datawall/DataWallCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { useModelPricing, useUpsertPricing, useDeletePricing } from '../hooks/useModelPricing'
import { formatCost } from '../utils/format'
import type { ModelPricingDto } from '@shared/api-types'

export function PricingConfigPanel() {
  const { t } = useTranslation('analytics')
  const { data: pricing, loading } = useModelPricing()
  const upsertPricing = useUpsertPricing()
  const deletePricing = useDeletePricing()
  const [editing, setEditing] = useState<ModelPricingDto | null>(null)
  const [isAdding, setIsAdding] = useState(false)

  const rows = pricing ?? []

  const handleSave = useCallback(
    (row: ModelPricingDto) => {
      void upsertPricing(row)
      setEditing(null)
      setIsAdding(false)
    },
    [upsertPricing],
  )

  const columns = useMemo<ColumnDef<ModelPricingDto>[]>(
    () => [
      {
        header: () => t('pricing.modelId'),
        accessorKey: 'modelId',
        cell: ({ row }) => <span className="font-medium text-xs">{row.original.modelId}</span>,
      },
      {
        header: () => <span className="block text-right">{t('pricing.input')}</span>,
        accessorKey: 'inputCostPerMillion',
        cell: ({ row }) => <span className="block text-right text-xs tabular-nums">{formatCost(row.original.inputCostPerMillion)}</span>,
      },
      {
        header: () => <span className="block text-right">{t('pricing.output')}</span>,
        accessorKey: 'outputCostPerMillion',
        cell: ({ row }) => <span className="block text-right text-xs tabular-nums">{formatCost(row.original.outputCostPerMillion)}</span>,
      },
      {
        header: () => <span className="block text-right">{t('pricing.cacheRead')}</span>,
        accessorKey: 'cacheReadCostPerMillion',
        cell: ({ row }) => <span className="block text-right text-xs tabular-nums">{formatCost(row.original.cacheReadCostPerMillion)}</span>,
      },
      {
        header: () => <span className="block text-right">{t('pricing.cacheCreation')}</span>,
        accessorKey: 'cacheCreationCostPerMillion',
        cell: ({ row }) => <span className="block text-right text-xs tabular-nums">{formatCost(row.original.cacheCreationCostPerMillion)}</span>,
      },
      {
        id: 'actions',
        header: () => '',
        cell: ({ row }) => (
          <div className="flex justify-end gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditing(row.original)}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => deletePricing(row.original.modelId)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ),
      },
    ],
    [t, deletePricing],
  )

  return (
    <DataWallCard
      className="h-full"
      title={t('pricing.title')}
      headerRight={
        <Button variant="outline" size="sm" onClick={() => setIsAdding(true)}>
          <Plus className="h-4 w-4" />
          {t('pricing.add')}
        </Button>
      }
    >
      {loading && !pricing ? (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{t('loading', { ns: 'common' })}</div>
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          getRowId={(r) => r.modelId}
          className="h-full"
          emptyState={<span className="text-sm text-muted-foreground">{t('noData')}</span>}
        />
      )}
      {(editing || isAdding) && (
        <PricingEditDialog
          row={editing}
          onClose={() => { setEditing(null); setIsAdding(false) }}
          onSave={handleSave}
        />
      )}
    </DataWallCard>
  )
}

function PricingEditDialog({
  row,
  onClose,
  onSave,
}: {
  row: ModelPricingDto | null
  onClose: () => void
  onSave: (row: ModelPricingDto) => void
}) {
  const { t } = useTranslation('analytics')
  const [modelId, setModelId] = useState(row?.modelId ?? '')
  const [displayName, setDisplayName] = useState(row?.displayName ?? '')
  const [input, setInput] = useState(row?.inputCostPerMillion?.toString() ?? '0')
  const [output, setOutput] = useState(row?.outputCostPerMillion?.toString() ?? '0')
  const [cacheRead, setCacheRead] = useState(row?.cacheReadCostPerMillion?.toString() ?? '0')
  const [cacheCreation, setCacheCreation] = useState(row?.cacheCreationCostPerMillion?.toString() ?? '0')

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{row ? t('pricing.edit') : t('pricing.add')}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-xs">
            {t('pricing.modelId')}
            <Input value={modelId} onChange={(e) => setModelId(e.target.value)} disabled={!!row} />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            {t('pricing.displayName')}
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            {t('pricing.input')}
            <Input type="number" step="0.01" value={input} onChange={(e) => setInput(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            {t('pricing.output')}
            <Input type="number" step="0.01" value={output} onChange={(e) => setOutput(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            {t('pricing.cacheRead')}
            <Input type="number" step="0.01" value={cacheRead} onChange={(e) => setCacheRead(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            {t('pricing.cacheCreation')}
            <Input type="number" step="0.01" value={cacheCreation} onChange={(e) => setCacheCreation(e.target.value)} />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('cancel', { ns: 'common' })}</Button>
          <Button onClick={() => onSave({ modelId, displayName: displayName || modelId, inputCostPerMillion: parseFloat(input) || 0, outputCostPerMillion: parseFloat(output) || 0, cacheReadCostPerMillion: parseFloat(cacheRead) || 0, cacheCreationCostPerMillion: parseFloat(cacheCreation) || 0 })}>
            {t('save', { ns: 'common' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
