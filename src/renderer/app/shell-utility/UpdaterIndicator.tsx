import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, ArrowRight, CheckCircle2, Download, Loader2, Sparkles } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useUpdaterStore } from '@/stores/updaterStore';

// 更新包通常 100+MB，统一以 MB/GB 展示。
function formatBytes(n?: number): string {
  if (!n || n <= 0) return '0 MB';
  const mb = n / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${mb.toFixed(1)} MB`;
}

// 顶栏「加入社群」左侧的更新指示：仅在有可用/下载中/已下载/出错时出现。
// 点击打开弹窗（autoDownload 已在后台下载）；弹窗按当前状态展示版本对比、更新内容、
// 下载进度或错误详情，下载完成后「立即安装」重启应用。
export function UpdaterIndicator() {
  const { t } = useTranslation();
  const status = useUpdaterStore((s) => s.status);
  const appVersion = useUpdaterStore((s) => s.appVersion);
  const dialogOpen = useUpdaterStore((s) => s.dialogOpen);
  const init = useUpdaterStore((s) => s.init);
  const openDialog = useUpdaterStore((s) => s.openDialog);
  const closeDialog = useUpdaterStore((s) => s.closeDialog);
  const install = useUpdaterStore((s) => s.install);
  const check = useUpdaterStore((s) => s.check);

  useEffect(() => init(), [init]);

  // error 也纳入：否则更新流程出错时整个组件 return null，已打开的弹窗会连同
  // 指示器一起消失，用户得不到任何失败反馈也无法重试。
  const state = status.state;
  // 顶栏指示器：仅在有可用/下载中/已下载/出错时出现（checking/not-available 不闪）。
  const showIndicator =
    state === 'available' ||
    state === 'downloading' ||
    state === 'downloaded' ||
    state === 'error';
  // 弹窗已打开时即便状态切到 checking/not-available（如点「重试」后）也要保持渲染，
  // 否则组件 return null 会让弹窗连同指示器一起消失，用户看不到检查/结果反馈。
  if (!showIndicator && !dialogOpen) return null;

  const isError = state === 'error';
  const isDownloading = state === 'downloading';
  const currentVersion = status.currentVersion || appVersion;
  const percent = Math.max(0, Math.min(100, status.percent ?? 0));

  // 弹窗标题（按状态）。
  const titleByState =
    state === 'checking'
      ? t('nav:shell.update.titleChecking')
      : state === 'available'
        ? t('nav:shell.update.titleAvailable')
        : state === 'downloading'
          ? t('nav:shell.update.titleDownloading')
          : state === 'downloaded'
            ? t('nav:shell.update.titleDownloaded')
            : state === 'not-available'
              ? t('nav:shell.update.titleUpToDate')
              : t('nav:shell.update.titleError');

  // 头部图标徽标（按状态着色）。
  const HeaderIcon = isError
    ? AlertCircle
    : state === 'downloaded' || state === 'not-available'
      ? CheckCircle2
      : state === 'checking'
        ? Loader2
        : Download;
  const badgeTint = isError
    ? 'bg-destructive/10 text-destructive'
    : 'bg-primary/10 text-primary';

  // 更新内容（发布说明）块——available / downloading / downloaded 时若有则展示。
  const releaseNotesBlock =
    status.releaseNotes && !isError ? (
      <div className="rounded-lg border border-border bg-muted/30 p-3">
        <div className="mb-1.5 flex items-center gap-1.5">
          <Sparkles className="size-3.5 text-primary" aria-hidden />
          <span className="text-xs font-medium text-muted-foreground">
            {t('nav:shell.update.releaseNotesTitle')}
          </span>
        </div>
        <div className="max-h-44 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
          {status.releaseNotes}
        </div>
      </div>
    ) : null;

  return (
    <>
      {showIndicator ? (
        <button
          type="button"
          title={t('nav:shell.update.title')}
          aria-label={t('nav:shell.update.title')}
          data-tauri-no-drag
          onClick={openDialog}
          className="no-drag relative inline-flex size-8 shrink-0 items-center justify-center rounded-[8px] text-primary transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <Download className="size-[17px]" strokeWidth={1.85} aria-hidden />
          <span
            className={`absolute right-1.5 top-1.5 size-2 rounded-full ring-2 ring-card ${
              isError ? 'bg-destructive' : 'bg-primary'
            } ${isDownloading ? 'animate-pulse' : ''}`}
          />
        </button>
      ) : null}

      <Dialog open={dialogOpen} onOpenChange={(o) => (o ? openDialog() : closeDialog())}>
        <DialogContent className="max-w-md">
          {/* 头部：图标徽标 + 标题 + 版本对比 */}
          <div className="flex items-start gap-3">
            <span
              className={`flex size-10 shrink-0 items-center justify-center rounded-full ${badgeTint}`}
            >
              <HeaderIcon
                className={`size-5 ${state === 'checking' ? 'animate-spin' : ''}`}
                strokeWidth={2}
                aria-hidden
              />
            </span>
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-base leading-tight">{titleByState}</DialogTitle>
              {status.version ? (
                <div className="mt-1 flex items-center gap-1.5 text-sm">
                  {currentVersion ? (
                    <>
                      <span className="font-mono text-muted-foreground">v{currentVersion}</span>
                      <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden />
                    </>
                  ) : null}
                  <span className="font-mono font-semibold text-primary">v{status.version}</span>
                </div>
              ) : null}
            </div>
          </div>

          <DialogDescription className="sr-only">{titleByState}</DialogDescription>

          {/* 主体：按状态 */}
          {state === 'checking' ? (
            <p className="text-sm text-muted-foreground">{t('nav:shell.update.checkingDesc')}</p>
          ) : state === 'not-available' ? (
            <div className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              <p className="text-sm text-foreground/90">{t('nav:shell.update.upToDate')}</p>
            </div>
          ) : state === 'available' ? (
            <div className="space-y-3">
              {releaseNotesBlock}
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                {t('nav:shell.update.preparing')}
              </div>
            </div>
          ) : state === 'downloading' ? (
            <div className="space-y-3">
              {releaseNotesBlock}
              <div className="space-y-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-2xl font-semibold tabular-nums text-foreground">
                    {percent}%
                  </span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {formatBytes(status.transferred)} / {formatBytes(status.total)}
                    {status.bytesPerSecond ? ` · ${formatBytes(status.bytesPerSecond)}/s` : ''}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-300"
                    style={{ width: `${percent}%` }}
                  />
                </div>
              </div>
            </div>
          ) : state === 'downloaded' ? (
            <div className="space-y-3">
              {releaseNotesBlock}
              <div className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                <p className="text-sm text-foreground/90">{t('nav:shell.update.ready')}</p>
              </div>
            </div>
          ) : isError ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
              <p className="text-sm text-destructive">{t('nav:shell.update.errorHint')}</p>
              {status.error ? (
                <details className="mt-2 group">
                  <summary className="cursor-pointer list-none text-xs text-muted-foreground transition-colors hover:text-foreground">
                    {t('nav:shell.update.errorDetail')}
                  </summary>
                  <pre className="mt-1.5 max-h-28 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/60 p-2 text-[11px] leading-relaxed text-muted-foreground">
                    {status.error}
                  </pre>
                </details>
              ) : null}
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              {t('nav:shell.update.later')}
            </Button>
            {isError ? (
              <Button onClick={() => void check()}>{t('nav:shell.update.retry')}</Button>
            ) : state === 'downloaded' ? (
              <Button onClick={() => void install()}>{t('nav:shell.update.installNow')}</Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
