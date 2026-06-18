import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { FolderOpen, RefreshCw } from 'lucide-react';
import { useSettingsStore, usePlatformStore } from '../../stores';
import { systemService } from '../../services/tauri';
import type { AgentId } from '../../types';

interface PlatformSettingsDialogProps {
  platform: AgentId;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const BATCH_OPTIONS = [0, 10, 15, 30, 60, 120, 240];

/**
 * PlatformSettingsDialog — per-platform settings opened from the account
 * toolbar gear. Reads/writes the same settings keys as before:
 *  - platform_refresh_interval_<p>: whole-platform batch quota sweep (0 = off)
 *  - refresh_interval_<p>: active-account quota refresh (2–30 min)
 *  - ide_path_<p>: app/IDE launch path. The placeholder is a platform+OS aware
 *    suggestion; the refresh button auto-detects the installed path.
 *  - require_online_check_<p>: per-platform「必须联网检查身份」(shown for all
 *    platforms; only Kiro acts on it at import time, default off = direct import).
 */
export function PlatformSettingsDialog({ platform, open, onOpenChange }: PlatformSettingsDialogProps) {
  const { t } = useTranslation('accounts');
  const { getDisplayName } = usePlatformStore();
  const {
    refreshIntervals,
    platformRefreshIntervals,
    idePaths,
    quotaRefreshConcurrency,
    setRefreshInterval,
    setPlatformRefreshInterval,
    setIdePath,
    setQuotaRefreshConcurrency,
    requireOnlineIdentityCheck,
    setRequireOnlineIdentityCheck,
    codexLaunchOnSwitch,
    setCodexLaunchOnSwitch,
  } = useSettingsStore();

  const activeInterval = refreshIntervals.get(platform) ?? 5;
  const batchInterval = platformRefreshIntervals.get(platform) ?? 10;
  const [pathDraft, setPathDraft] = useState('');
  const [suggestion, setSuggestion] = useState('');
  const [detecting, setDetecting] = useState(false);
  // Local draft for the concurrency text box so typing doesn't fight the clamp;
  // committed (clamped to 1–100) on blur / Enter.
  const [concurrencyDraft, setConcurrencyDraft] = useState(String(quotaRefreshConcurrency));

  // Keep the concurrency draft in sync when the dialog (re)opens or the stored
  // value changes elsewhere.
  useEffect(() => {
    setConcurrencyDraft(String(quotaRefreshConcurrency));
  }, [quotaRefreshConcurrency, open]);

  const commitConcurrency = () => {
    const n = Number(concurrencyDraft);
    // Snap to the stored value if invalid, otherwise clamp into 1–100. Always
    // write the normalized value back to the draft so out-of-range input (e.g.
    // 111) can never linger in the box, even when the store value is unchanged.
    const clamped = Number.isFinite(n) && n >= 1
      ? Math.min(100, Math.max(1, Math.round(n)))
      : quotaRefreshConcurrency;
    setConcurrencyDraft(String(clamped));
    void setQuotaRefreshConcurrency(clamped);
  };

  // On open / platform change: sync the draft with the stored path and fetch a
  // platform+OS aware placeholder suggestion.
  useEffect(() => {
    if (!open) return;
    setPathDraft(idePaths[platform] ?? '');
    let cancelled = false;
    systemService
      .detectAppPath(platform)
      .then((info) => { if (!cancelled) setSuggestion(info.suggestion); })
      .catch(() => { if (!cancelled) setSuggestion(''); });
    return () => { cancelled = true; };
  }, [open, platform, idePaths]);

  const handleBrowse = async () => {
    const picked = await systemService.pickPath();
    if (picked) {
      setPathDraft(picked);
      void setIdePath(platform, picked);
    }
  };

  const handlePathBlur = () => {
    const trimmed = pathDraft.trim();
    if (trimmed !== (idePaths[platform] ?? '')) void setIdePath(platform, trimmed);
  };

  // Auto-detect the installed app path for this platform on the current OS.
  const handleDetect = async () => {
    setDetecting(true);
    try {
      const info = await systemService.detectAppPath(platform);
      setSuggestion(info.suggestion);
      if (info.detected) {
        setPathDraft(info.detected);
        void setIdePath(platform, info.detected);
        toast.success(t('platformSettings.launch.detected', { path: info.detected }));
      } else {
        toast.error(t('platformSettings.launch.notFound'));
      }
    } finally {
      setDetecting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('platformSettings.title', { platform: getDisplayName(platform) })}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Batch interval */}
          <div className="flex items-center justify-between gap-3">
            <label className="text-[13px] text-foreground">
              {t('platformSettings.autoRefresh.batchLabel')}
            </label>
            <Select
              value={String(batchInterval)}
              onValueChange={(v) => void setPlatformRefreshInterval(platform, Number(v))}
            >
              <SelectTrigger className="h-8 w-[116px] rounded-[8px] text-[12px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BATCH_OPTIONS.map((min) => (
                  <SelectItem key={min} value={String(min)}>
                    {min === 0
                      ? t('platformSettings.autoRefresh.batchOff')
                      : t('platformSettings.autoRefresh.minutes', { count: min })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Active interval */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[13px] text-foreground">
                {t('platformSettings.autoRefresh.activeLabel')}
              </label>
              <span className="text-[12px] tabular-nums text-muted-foreground">
                {t('platformSettings.autoRefresh.minutes', { count: activeInterval })}
              </span>
            </div>
            <input
              type="range"
              min={2}
              max={30}
              value={activeInterval}
              aria-label={t('platformSettings.autoRefresh.activeLabel')}
              className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary"
              onChange={(e) => void setRefreshInterval(platform, Number(e.target.value))}
            />
          </div>

          {/* Batch sweep concurrency (global): input in the title row, slider below */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-3">
              <label className="text-[13px] text-foreground">
                {t('platformSettings.autoRefresh.concurrencyLabel')}
                <span className="ml-1 text-[11px] text-muted-foreground">
                  {t('platformSettings.autoRefresh.global')}
                </span>
              </label>
              <Input
                type="number"
                min={1}
                max={100}
                value={concurrencyDraft}
                aria-label={t('platformSettings.autoRefresh.concurrencyLabel')}
                className="h-8 w-[72px] rounded-[8px] text-center text-[12px]"
                onChange={(e) => setConcurrencyDraft(e.target.value)}
                onBlur={commitConcurrency}
                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
              />
            </div>
            <input
              type="range"
              min={1}
              max={100}
              value={quotaRefreshConcurrency}
              aria-label={t('platformSettings.autoRefresh.concurrencyLabel')}
              className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary"
              onChange={(e) => void setQuotaRefreshConcurrency(Number(e.target.value))}
            />
          </div>

          {/* Launch path */}
          <div className="space-y-1.5">
            <label className="text-[13px] text-foreground">
              {t('platformSettings.launch.title')}
            </label>
            <div className="flex items-center gap-1.5">
              <Input
                value={pathDraft}
                onChange={(e) => setPathDraft(e.target.value)}
                onBlur={handlePathBlur}
                placeholder={suggestion || t('platformSettings.launch.placeholder')}
                className="h-8 flex-1 rounded-[8px] text-[12px]"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={t('platformSettings.launch.browse')}
                title={t('platformSettings.launch.browse')}
                className="size-8 rounded-[8px]"
                onClick={handleBrowse}
              >
                <FolderOpen className="size-3.5" strokeWidth={1.9} />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={t('platformSettings.launch.detect')}
                title={t('platformSettings.launch.detect')}
                className="size-8 rounded-[8px]"
                disabled={detecting}
                onClick={handleDetect}
              >
                <RefreshCw className={`size-3.5 ${detecting ? 'animate-spin' : ''}`} strokeWidth={1.9} />
              </Button>
            </div>
          </div>

          {/* Platform-specific: Codex 切换后自动重启 App（停-写-启） */}
          {platform === 'codex' ? (
            <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-3">
              <label className="text-[13px] text-foreground">
                {t('platformSettings.special.codexLaunchOnSwitch')}
              </label>
              <Switch
                checked={codexLaunchOnSwitch}
                onCheckedChange={(v) => void setCodexLaunchOnSwitch(v)}
                aria-label={t('platformSettings.special.codexLaunchOnSwitch')}
              />
            </div>
          ) : null}

          {/* 必须联网检查身份（所有平台）：默认关=导入时直接导入、不联网；开=导入时联网核对身份，失败则阻止。 */}
          <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-3">
            <label className="text-[13px] text-foreground">
              {t('platformSettings.special.requireOnlineCheck')}
            </label>
            <Switch
              checked={requireOnlineIdentityCheck[platform] ?? false}
              onCheckedChange={(v) => void setRequireOnlineIdentityCheck(platform, v)}
              aria-label={t('platformSettings.special.requireOnlineCheck')}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default PlatformSettingsDialog;
