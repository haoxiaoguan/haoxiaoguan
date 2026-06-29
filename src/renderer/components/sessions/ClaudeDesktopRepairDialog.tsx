import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { sessionsService } from '@/services/tauri'
import type { ClaudeDesktopRepairPreviewDto, ClaudeDesktopRepairResultDto } from '@shared/api-types'

export function ClaudeDesktopRepairDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation('nav')
  const [preview, setPreview] = useState<ClaudeDesktopRepairPreviewDto | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ClaudeDesktopRepairResultDto | null>(null)

  useEffect(() => {
    if (!open) {
      setPreview(null)
      setResult(null)
      return
    }
    void sessionsService.claudeDesktopRepairPreview().then(setPreview).catch((e) => toast.error(String(e)))
  }, [open])

  const onRepair = async () => {
    if (!preview?.currentNamespace) return
    setBusy(true)
    try {
      const r = await sessionsService.claudeDesktopRepair({
        targetNamespace: preview.currentNamespace.key,
        sourceNamespaces: preview.sourceNamespaces.map((n) => n.key),
      })
      setResult(r)
      toast.success(t('sessionsView.desktopRepairDone', { n: r.copied }))
      await sessionsService.claudeDesktopRepairPreview().then(setPreview).catch(() => {})
    } catch (e) {
      toast.error(String(e))
    } finally {
      setBusy(false)
    }
  }

  const onUndo = async () => {
    if (!result) return
    setBusy(true)
    try {
      await sessionsService.claudeDesktopRepairRollback(result.backupId)
      toast.success(t('sessionsView.desktopRepairUndone'))
      onOpenChange(false)
    } catch (e) {
      toast.error(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('sessionsView.desktopRepair')}</DialogTitle>
        </DialogHeader>
        {!preview ? (
          <div className="py-6 text-center text-[12px] text-muted-foreground">...</div>
        ) : !preview.available ? (
          <div className="py-6 text-center text-[12px] text-muted-foreground">
            {t('sessionsView.desktopRepairUnavailable')}
          </div>
        ) : (
          <div className="space-y-3 text-[12.5px]">
            <p className="text-muted-foreground">{t('sessionsView.desktopRepairExplain')}</p>
            <div className="min-w-0 rounded-[8px] border border-border/60 p-3">
              <div className="mb-1.5 min-w-0 leading-relaxed">
                {t('sessionsView.desktopRepairCurrent')}:{' '}
                <b className="break-all font-mono">{preview.currentNamespace?.key}</b>
              </div>
              <div className="space-y-1">
                {preview.sourceNamespaces.map((ns) => (
                  <div key={ns.key} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                    <span className="min-w-0 break-all font-mono leading-relaxed">{ns.key}</span>
                    <span className="shrink-0 text-muted-foreground">{ns.codeSessionCount}</span>
                  </div>
                ))}
              </div>
              <div className="mt-2 text-primary">
                {t('sessionsView.desktopRepairCount', { n: preview.repairable })}
              </div>
            </div>
            {preview.desktopRunning && (
              <p className="text-amber-600">{t('sessionsView.desktopRepairRunning')}</p>
            )}
            <p className="text-[11px] text-muted-foreground/70">{t('sessionsView.desktopRepairNote')}</p>
          </div>
        )}
        <DialogFooter>
          {result ? (
            <Button variant="outline" disabled={busy} onClick={() => void onUndo()}>
              {t('sessionsView.repairUndo')}
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('clientConfigPage.historyDialog.close')}
          </Button>
          <Button
            disabled={busy || !preview?.available || (preview?.repairable ?? 0) === 0}
            onClick={() => void onRepair()}
          >
            {t('sessionsView.repairRun')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
