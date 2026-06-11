/**
 * ExportAccountsDialog — 导出账号为 token JSON（目前仅 cpa 格式）。
 * accountIds 传单个 id 即单账号导出，传平台全部 id 即全量导出。
 *
 * 打开即自动加载并展示脱敏内容（值首尾各留 2 字符）；「预览」切换完整明文显示，
 * 「复制」「下载」始终输出完整明文。后续平台可能支持不同格式，格式下拉留好扩展位。
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Copy, Download, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import { accountService } from '../../services/tauri';

interface ExportAccountsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 当前平台 id（用于下载文件名）。 */
  platform: string;
  /** 待导出的账号 id（当前平台全部账号）。 */
  accountIds: string[];
}

/** 单个值脱敏：首尾各留 2 字符，中间打码（短值直接全打码）。 */
function maskString(s: string): string {
  if (s.length <= 4) return '***';
  return `${s.slice(0, 2)}***${s.slice(-2)}`;
}

function maskDeep(v: unknown): unknown {
  if (typeof v === 'string') return maskString(v);
  if (Array.isArray(v)) return v.map(maskDeep);
  if (v !== null && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).map(([k, val]) => [k, maskDeep(val)]),
    );
  }
  return v;
}

export default function ExportAccountsDialog({
  open,
  onOpenChange,
  platform,
  accountIds,
}: ExportAccountsDialogProps) {
  const { t } = useTranslation('accounts');
  const [format, setFormat] = useState('cpa');
  const [masked, setMasked] = useState<string | null>(null);
  // 「预览」按钮切换：false=展示脱敏内容（默认），true=展示完整明文。
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 完整明文留在 ref 里，仅在 revealed 时渲染。
  const fullJsonRef = useRef<string | null>(null);

  // 打开即自动加载并展示脱敏内容。
  useEffect(() => {
    if (!open) return;
    setMasked(null);
    setRevealed(false);
    setError(null);
    fullJsonRef.current = null;
    if (accountIds.length === 0) return;
    setBusy(true);
    accountService
      .exportAccountsCpa(accountIds)
      .then((json) => {
        fullJsonRef.current = json;
        setMasked(JSON.stringify(maskDeep(JSON.parse(json)), null, 2));
      })
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setBusy(false));
    // accountIds 来自父组件的 map()，引用每次渲染都变，依赖 open 即可。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const run = async (action: (json: string) => void | Promise<void>) => {
    const json = fullJsonRef.current;
    if (json === null) return;
    setError(null);
    try {
      await action(json);
    } catch (e) {
      setError(String(e));
    }
  };

  const handleToggleReveal = () => setRevealed((v) => !v);

  const handleCopy = () =>
    run(async (json) => {
      await navigator.clipboard.writeText(json);
      toast.success(t('exportDialog.copied'));
    });

  const handleDownload = () =>
    run((json) => {
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${platform}-accounts-${format}-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-5 sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>{t('exportDialog.title')}</DialogTitle>
        </DialogHeader>

        <div className="mt-2 space-y-3">
          {/* 导出格式 */}
          <div className="flex items-center gap-3">
            <span className="text-[13px] font-medium text-foreground">
              {t('exportDialog.format')}
            </span>
            <Select value={format} onValueChange={setFormat} disabled={busy}>
              <SelectTrigger className="h-9 w-[140px] rounded-[8px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cpa">{t('exportDialog.formatCpa')}</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">
              {t('exportDialog.count', { count: accountIds.length })}
            </span>
          </div>

          {/* 操作按钮 */}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 rounded-[8px]"
              onClick={handleToggleReveal}
              disabled={busy || masked === null}
            >
              {revealed ? (
                <EyeOff className="size-3.5" strokeWidth={1.9} />
              ) : (
                <Eye className="size-3.5" strokeWidth={1.9} />
              )}
              {revealed ? t('exportDialog.hide') : t('exportDialog.preview')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 rounded-[8px]"
              onClick={handleCopy}
              disabled={busy || masked === null}
            >
              <Copy className="size-3.5" strokeWidth={1.9} />
              {t('exportDialog.copy')}
            </Button>
            <Button
              size="sm"
              className="gap-1.5 rounded-[8px]"
              onClick={handleDownload}
              disabled={busy || masked === null}
            >
              <Download className="size-3.5" strokeWidth={1.9} />
              {t('exportDialog.download')}
            </Button>
          </div>

          {/* 预览区：默认脱敏，「预览」切换完整明文 */}
          <pre className="max-h-[360px] min-h-[220px] overflow-auto whitespace-pre-wrap break-all rounded-[10px] border border-primary/30 bg-primary/5 p-3 font-mono text-xs text-foreground">
            {accountIds.length === 0
              ? t('exportDialog.empty')
              : busy
                ? t('exportDialog.loading')
                : (revealed ? fullJsonRef.current : masked) ?? ''}
          </pre>

          {error && (
            <div className="rounded-md border border-red-500/40 bg-red-500/5 px-3 py-2 text-xs text-red-700 dark:text-red-400">
              {error}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
