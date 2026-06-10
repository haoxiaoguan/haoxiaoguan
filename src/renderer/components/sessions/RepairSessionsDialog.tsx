import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { sessionsService } from '@/services/tauri'
import { providerLabel } from './ProviderTag'
import type { CodexRepairPreviewDto, CodexRepairProgressDto, CodexRepairResultDto } from '@shared/api-types'

export function RepairSessionsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation('nav')
  const [preview, setPreview] = useState<CodexRepairPreviewDto | null>(null)
  const [rewriteRollout, setRewriteRollout] = useState(true)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<CodexRepairResultDto | null>(null)
  const [progress, setProgress] = useState<CodexRepairProgressDto | null>(null)

  useEffect(() => {
    if (!open) { setPreview(null); setResult(null); setProgress(null); return }
    void sessionsService.repairPreview().then(setPreview).catch((e) => toast.error(String(e)))
  }, [open])

  const onRepair = async () => {
    if (!preview?.currentProvider) return
    setBusy(true)
    setProgress(null)
    const unsub = sessionsService.onRepairProgress((p) => setProgress(p))
    try {
      const r = await sessionsService.repair({ targetProvider: preview.currentProvider, rewriteRollout })
      setResult(r)
      toast.success(t('sessionsView.repairDone', { n: r.updatedThreads }))
    } catch (e) { toast.error(String(e)) } finally { unsub(); setBusy(false) }
  }

  const onUndo = async () => {
    if (!result) return
    setBusy(true)
    try { await sessionsService.repairRollback(result.backupId); toast.success(t('sessionsView.repairUndone')); onOpenChange(false) }
    catch (e) { toast.error(String(e)) } finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{t('sessionsView.repair')}</DialogTitle></DialogHeader>
        {!preview ? <div className="py-6 text-center text-[12px] text-muted-foreground">…</div>
         : !preview.available ? <div className="py-6 text-center text-[12px] text-muted-foreground">{t('sessionsView.repairUnavailable')}</div>
         : (
          <div className="space-y-3 text-[12.5px]">
            <p className="text-muted-foreground">{t('sessionsView.repairExplain')}</p>
            <div className="rounded-[8px] border border-border/60 p-3">
              <div className="mb-1.5">{t('sessionsView.repairCurrent')}: <b>{providerLabel(preview.currentProvider ?? '-')}</b></div>
              <div className="space-y-1">
                {preview.counts.map((c) => (
                  <div key={c.provider} className="flex justify-between"><span>{providerLabel(c.provider)}</span><span className="text-muted-foreground">{c.count}</span></div>
                ))}
              </div>
              <div className="mt-2 text-primary">{t('sessionsView.repairCount', { n: preview.repairable })}</div>
            </div>
            {preview.codexRunning && <p className="text-amber-600">{t('sessionsView.repairCodexRunning')}</p>}
            <label className="flex items-center justify-between"><span>{t('sessionsView.repairRewriteRollout')}</span>
              <Switch checked={rewriteRollout} onCheckedChange={setRewriteRollout} /></label>
            <p className="text-[11px] text-muted-foreground/70">{t('sessionsView.repairEncryptedNote')}</p>
          </div>
        )}
        {/* 进度条：仅 busy 时显示 */}
        {busy && progress && (
          <div className="space-y-1.5 px-1">
            <div className="flex items-center justify-between text-[11.5px] text-muted-foreground">
              <span>
                {progress.message}
                {progress.current != null && progress.total != null
                  ? ` (${progress.current}/${progress.total})`
                  : null}
              </span>
              <span className="shrink-0 tabular-nums">{progress.percent}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-200"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
          </div>
        )}
        <DialogFooter>
          {result ? <Button variant="outline" disabled={busy} onClick={() => void onUndo()}>{t('sessionsView.repairUndo')}</Button> : null}
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('clientConfigPage.historyDialog.close')}</Button>
          <Button disabled={busy || !preview?.available || !preview?.currentProvider || (preview?.repairable ?? 0) === 0} onClick={() => void onRepair()}>
            {t('sessionsView.repairRun')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
