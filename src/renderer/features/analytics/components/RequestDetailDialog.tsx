import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { formatTokens, formatCost } from '../utils/format'
import type { UsageEventRowDto } from '@shared/api-types'

interface RequestDetailDialogProps {
  row: UsageEventRowDto
  onClose: () => void
}

export function RequestDetailDialog({ row, onClose }: RequestDetailDialogProps) {
  const { t } = useTranslation()
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('analytics:requestDetail.title')}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <DetailItem label={t('analytics:requestDetail.time')} value={new Date(row.occurredAt * 1000).toLocaleString()} />
          <DetailItem label={t('analytics:requestDetail.agent')} value={row.agentId} />
          <DetailItem label={t('analytics:requestDetail.source')} value={row.source} />
          <DetailItem label={t('analytics:requestDetail.model')} value={row.model ?? '—'} />
          <DetailItem label={t('analytics:requestDetail.inputTokens')} value={formatTokens(row.inputTokens)} />
          <DetailItem label={t('analytics:requestDetail.outputTokens')} value={formatTokens(row.outputTokens)} />
          <DetailItem label={t('analytics:requestDetail.cacheRead')} value={formatTokens(row.cacheReadTokens)} />
          <DetailItem label={t('analytics:requestDetail.cacheCreation')} value={formatTokens(row.cacheCreationTokens)} />
          <DetailItem label={t('analytics:requestDetail.totalCost')} value={formatCost(row.totalCostUsd)} />
          <DetailItem label={t('analytics:requestDetail.status')} value={row.status?.toString() ?? '—'} />
          {row.durationMs != null && (
            <DetailItem label={t('analytics:requestDetail.duration')} value={`${row.durationMs}ms`} />
          )}
          {row.errorKind && (
            <DetailItem label={t('analytics:requestDetail.errorKind')} value={row.errorKind} />
          )}
          {row.accountId && (
            <DetailItem label={t('analytics:requestDetail.account')} value={row.accountId} />
          )}
          {row.comboName && (
            <DetailItem label={t('analytics:requestDetail.combo')} value={row.comboName} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  )
}
