import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useUpdaterStore } from '@/stores/updaterStore';

// 顶栏「加入社群」左侧的更新指示：仅在有可用/下载中/已下载更新时出现。
// 点击打开弹窗（autoDownload 已在后台下载），下载完成后「立即安装」重启应用。
export function UpdaterIndicator() {
  const { t } = useTranslation();
  const status = useUpdaterStore((s) => s.status);
  const dialogOpen = useUpdaterStore((s) => s.dialogOpen);
  const init = useUpdaterStore((s) => s.init);
  const openDialog = useUpdaterStore((s) => s.openDialog);
  const closeDialog = useUpdaterStore((s) => s.closeDialog);
  const install = useUpdaterStore((s) => s.install);

  useEffect(() => init(), [init]);

  const hasUpdate =
    status.state === 'available' ||
    status.state === 'downloading' ||
    status.state === 'downloaded';
  if (!hasUpdate) return null;

  return (
    <>
      <button
        type="button"
        title={t('nav:shell.update.title')}
        aria-label={t('nav:shell.update.title')}
        data-tauri-no-drag
        onClick={openDialog}
        className="no-drag relative inline-flex size-8 shrink-0 items-center justify-center rounded-[8px] text-primary transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <Download className="size-[17px]" strokeWidth={1.85} aria-hidden />
        <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-primary ring-2 ring-card" />
      </button>

      <Dialog open={dialogOpen} onOpenChange={(o) => (o ? openDialog() : closeDialog())}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('nav:shell.update.title')}</DialogTitle>
            <DialogDescription>
              {status.version
                ? t('nav:shell.update.newVersion', { version: status.version })
                : t('nav:shell.update.desc')}
            </DialogDescription>
          </DialogHeader>

          {status.state === 'downloading' ? (
            <div className="space-y-2">
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300"
                  style={{ width: `${Math.max(0, Math.min(100, status.percent ?? 0))}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {t('nav:shell.update.downloading', { percent: status.percent ?? 0 })}
              </p>
            </div>
          ) : status.state === 'available' ? (
            <p className="text-sm text-muted-foreground">{t('nav:shell.update.preparing')}</p>
          ) : status.state === 'downloaded' ? (
            <p className="text-sm text-foreground">{t('nav:shell.update.ready')}</p>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              {t('nav:shell.update.later')}
            </Button>
            <Button onClick={() => void install()} disabled={status.state !== 'downloaded'}>
              {t('nav:shell.update.installNow')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
