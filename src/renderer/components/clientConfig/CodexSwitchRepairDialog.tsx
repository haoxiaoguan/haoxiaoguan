import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import type { CodexRepairProgressDto } from '@shared/api-types'

interface CodexSwitchRepairDialogProps {
  open: boolean
  providerName: string
  onConfirm: (repairToo: boolean) => Promise<void> | void
  onCancel: () => void
  busy: boolean
  progress: CodexRepairProgressDto | null
}

export function CodexSwitchRepairDialog({
  open,
  providerName,
  onConfirm,
  onCancel,
  busy,
  progress,
}: CodexSwitchRepairDialogProps) {
  const { t } = useTranslation('nav')
  const [repairToo, setRepairToo] = useState(true)

  const handleConfirm = () => {
    void onConfirm(repairToo)
  }

  // 确认按钮文案：优先根据 progress.phase 细化；busy 无 progress 时用通用"切换中…"
  const confirmLabel = (() => {
    if (!busy) return t('clientConfigPage.codexSwitchConfirm')
    if (progress?.phase === 'done') return t('clientConfigPage.codexSwitchConfirm')
    if (progress) return t('clientConfigPage.codexSwitchMigrating')
    return t('clientConfigPage.codexSwitchMigrating')
  })()

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !busy) onCancel()
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('clientConfigPage.codexSwitchTitle', { name: providerName })}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 text-[12.5px]">
          <p className="text-muted-foreground">
            {t('clientConfigPage.codexSwitchDesc', { name: providerName })}
          </p>

          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-[8px] border border-border/60 px-3 py-2.5">
            <span className="text-[12.5px] text-foreground">
              {t('clientConfigPage.codexSwitchRepairToggle')}
            </span>
            <Switch
              checked={repairToo}
              onCheckedChange={setRepairToo}
              disabled={busy}
              aria-label={t('clientConfigPage.codexSwitchRepairToggle')}
            />
          </label>
        </div>

        {/* 进度条：busy 时显示（即使 progress 还未到来也预占位） */}
        {busy && (
          <div className="space-y-1.5 px-1">
            <div className="flex items-center justify-between text-[11.5px] text-muted-foreground">
              <span>
                {progress
                  ? progress.message +
                    (progress.current != null && progress.total != null
                      ? ` (${progress.current}/${progress.total})`
                      : '')
                  : t('clientConfigPage.codexSwitchMigrating')}
              </span>
              <span className="shrink-0 tabular-nums">{progress ? `${progress.percent}%` : ''}</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-200"
                style={{ width: progress ? `${progress.percent}%` : '0%' }}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onCancel}>
            {t('clientConfigPage.historyDialog.close')}
          </Button>
          <Button disabled={busy} onClick={handleConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
