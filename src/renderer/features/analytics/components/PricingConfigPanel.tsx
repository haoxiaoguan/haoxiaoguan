import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { useModelPricing, useUpsertPricing, useDeletePricing } from '../hooks/useModelPricing'
import { formatCost } from '../utils/format'
import type { ModelPricingDto } from '@shared/api-types'

export function PricingConfigPanel() {
  const { t } = useTranslation()
  const { data: pricing, loading } = useModelPricing()
  const upsertMutation = useUpsertPricing()
  const deleteMutation = useDeletePricing()
  const [editing, setEditing] = useState<ModelPricingDto | null>(null)
  const [isAdding, setIsAdding] = useState(false)

  const rows = pricing ?? []

  return (
    <Card className="border border-border/50 bg-card/40">
      <CardContent className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-medium">{t('analytics:pricing.title')}</span>
          <Button size="sm" variant="outline" onClick={() => setIsAdding(true)}>
            <Plus className="h-4 w-4" />
            {t('analytics:pricing.add')}
          </Button>
        </div>
        {loading ? (
          <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">{t('common:loading')}</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('analytics:pricing.modelId')}</TableHead>
                <TableHead className="text-right">{t('analytics:pricing.input')}</TableHead>
                <TableHead className="text-right">{t('analytics:pricing.output')}</TableHead>
                <TableHead className="text-right">{t('analytics:pricing.cacheRead')}</TableHead>
                <TableHead className="text-right">{t('analytics:pricing.cacheCreation')}</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.modelId}>
                  <TableCell className="font-medium text-xs">{row.modelId}</TableCell>
                  <TableCell className="text-right text-xs tabular-nums">{formatCost(row.inputCostPerMillion)}</TableCell>
                  <TableCell className="text-right text-xs tabular-nums">{formatCost(row.outputCostPerMillion)}</TableCell>
                  <TableCell className="text-right text-xs tabular-nums">{formatCost(row.cacheReadCostPerMillion)}</TableCell>
                  <TableCell className="text-right text-xs tabular-nums">{formatCost(row.cacheCreationCostPerMillion)}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button size="icon" variant="ghost" onClick={() => setEditing(row)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => deleteMutation(row.modelId)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {(editing || isAdding) && (
        <PricingEditDialog
          row={editing}
          onClose={() => { setEditing(null); setIsAdding(false) }}
          onSave={(row) => { upsertMutation(row); setEditing(null); setIsAdding(false) }}
        />
      )}
    </Card>
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
  const { t } = useTranslation()
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
          <DialogTitle>{row ? t('analytics:pricing.edit') : t('analytics:pricing.add')}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-xs">
            {t('analytics:pricing.modelId')}
            <Input value={modelId} onChange={(e) => setModelId(e.target.value)} disabled={!!row} />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            {t('analytics:pricing.displayName')}
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            {t('analytics:pricing.input')}
            <Input type="number" step="0.01" value={input} onChange={(e) => setInput(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            {t('analytics:pricing.output')}
            <Input type="number" step="0.01" value={output} onChange={(e) => setOutput(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            {t('analytics:pricing.cacheRead')}
            <Input type="number" step="0.01" value={cacheRead} onChange={(e) => setCacheRead(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            {t('analytics:pricing.cacheCreation')}
            <Input type="number" step="0.01" value={cacheCreation} onChange={(e) => setCacheCreation(e.target.value)} />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('common:cancel')}</Button>
          <Button onClick={() => onSave({ modelId, displayName: displayName || modelId, inputCostPerMillion: parseFloat(input) || 0, outputCostPerMillion: parseFloat(output) || 0, cacheReadCostPerMillion: parseFloat(cacheRead) || 0, cacheCreationCostPerMillion: parseFloat(cacheCreation) || 0 })}>
            {t('common:save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
