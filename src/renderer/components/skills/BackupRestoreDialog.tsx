import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { History, Loader2, RotateCcw, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { skillsService } from '../../services/tauri';
import type { SkillBackupEntry } from '../../types';

interface BackupRestoreDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRestored?: () => void;
}

interface ParsedSnapshot {
  name?: string;
  description?: string;
  directory?: string;
}

export function BackupRestoreDialog({ open, onOpenChange, onRestored }: BackupRestoreDialogProps) {
  const { t } = useTranslation();
  const [backups, setBackups] = useState<SkillBackupEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyKind, setBusyKind] = useState<'restore' | 'delete' | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    skillsService
      .getSkillBackups()
      .then((items) => {
        if (cancelled) return;
        setBackups(items);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(String(err));
        setBackups([]);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const handleRestore = async (entry: SkillBackupEntry) => {
    setError(null);
    setBusyId(entry.backup_id);
    setBusyKind('restore');
    try {
      await skillsService.restoreSkillBackup(entry.backup_id);
      setBackups((prev) => prev.filter((item) => item.backup_id !== entry.backup_id));
      onRestored?.();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusyId(null);
      setBusyKind(null);
    }
  };

  const handleDelete = async (entry: SkillBackupEntry) => {
    setError(null);
    setBusyId(entry.backup_id);
    setBusyKind('delete');
    try {
      await skillsService.deleteSkillBackup(entry.backup_id);
      setBackups((prev) => prev.filter((item) => item.backup_id !== entry.backup_id));
    } catch (err) {
      setError(String(err));
    } finally {
      setBusyId(null);
      setBusyKind(null);
    }
  };

  const hasBackups = backups.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl gap-3 p-5">
        <DialogHeader>
          <DialogTitle>{t('skills.backup.title', '从备份恢复 Skills')}</DialogTitle>
          <DialogDescription>
            {t(
              'skills.backup.desc',
              '卸载 Skill 时会自动备份。可以在这里把任何一份备份恢复为已安装状态。',
            )}
          </DialogDescription>
        </DialogHeader>

        {error ? <div className="text-[12px] text-destructive">{error}</div> : null}

        <div className="rounded-[8px] border border-border bg-card">
          <ScrollArea className="h-[320px]">
            {loading ? (
              <div className="flex flex-col gap-2 p-3">
                {Array.from({ length: 4 }).map((_, idx) => (
                  <Skeleton key={idx} className="h-16 rounded-[8px]" />
                ))}
              </div>
            ) : hasBackups ? (
              <ul className="divide-y divide-border/80">
                {backups.map((entry) => (
                  <BackupRow
                    key={entry.backup_id}
                    entry={entry}
                    busy={busyId === entry.backup_id}
                    busyKind={busyId === entry.backup_id ? busyKind : null}
                    onRestore={() => handleRestore(entry)}
                    onDelete={() => handleDelete(entry)}
                  />
                ))}
              </ul>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-10 text-center">
                <History className="size-8 text-muted-foreground/70" strokeWidth={1.6} aria-hidden />
                <p className="text-[13px] font-medium text-foreground">
                  {t('skills.backup.empty', '暂无可恢复的备份')}
                </p>
                <p className="text-[12px] text-muted-foreground">
                  {t('skills.backup.emptyHint', '卸载 Skill 时会自动产生备份。')}
                </p>
              </div>
            )}
          </ScrollArea>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.close', '关闭')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BackupRow({
  entry,
  busy,
  busyKind,
  onRestore,
  onDelete,
}: {
  entry: SkillBackupEntry;
  busy: boolean;
  busyKind: 'restore' | 'delete' | null;
  onRestore: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const snapshot = useMemo<ParsedSnapshot>(() => {
    try {
      return JSON.parse(entry.snapshot_json) as ParsedSnapshot;
    } catch {
      return {};
    }
  }, [entry.snapshot_json]);

  const title = snapshot.name || snapshot.directory || entry.skill_id;
  const subtitle = snapshot.description || entry.archive_path;
  const createdAt = new Date(entry.created_at * 1000);
  const createdLabel = Number.isNaN(createdAt.getTime())
    ? '—'
    : createdAt.toLocaleString();

  return (
    <li className="flex items-start gap-3 px-3 py-2.5">
      <div className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-[8px] border border-border bg-background text-muted-foreground">
        <History className="size-4" strokeWidth={1.85} aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-foreground">{title}</div>
        <div className="truncate text-[12px] text-muted-foreground">{subtitle}</div>
        <div className="mt-0.5 text-[11.5px] text-muted-foreground/80">
          {t('skills.backup.createdAt', '备份于')} {createdLabel}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={onRestore}
          className="h-8 rounded-[8px] px-2.5 text-[12px]"
        >
          {busy && busyKind === 'restore' ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <RotateCcw aria-hidden />
          )}
          {t('skills.backup.restoreAction', '恢复')}
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          disabled={busy}
          onClick={onDelete}
          aria-label={t('skills.backup.delete', '删除备份')}
          className="text-muted-foreground hover:text-destructive"
        >
          {busy && busyKind === 'delete' ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <Trash2 aria-hidden />
          )}
        </Button>
      </div>
    </li>
  );
}
