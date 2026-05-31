import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderSearch, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { skillsService } from '../../services/tauri';
import { AgentLogo, SKILL_AGENTS, type SkillAgentId } from './AgentLogo';

interface ImportUnmanagedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported?: () => void;
}

/** 聚合后的未管理 Skill：合并多个 agent 下同名目录 */
interface AggregatedUnmanaged {
  dirName: string;
  path: string;
  foundIn: SkillAgentId[];
}

type AppsSelection = Record<SkillAgentId, boolean>;

const EMPTY_APPS: AppsSelection = {
  claude: false,
  codex: false,
  gemini: false,
  opencode: false,
  hermes: false,
};

export function ImportUnmanagedDialog({ open, onOpenChange, onImported }: ImportUnmanagedDialogProps) {
  const { t } = useTranslation();
  const [items, setItems] = useState<AggregatedUnmanaged[]>([]);
  const [selectedDirs, setSelectedDirs] = useState<Set<string>>(new Set());
  const [appsByDir, setAppsByDir] = useState<Record<string, AppsSelection>>({});
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const aggregated = new Map<string, AggregatedUnmanaged>();
        const results = await Promise.all(
          SKILL_AGENTS.map(async (agent) => {
            try {
              const entries = await skillsService.scanUnmanagedSkills(agent.id);
              return { agentId: agent.id, entries };
            } catch (err) {
              return { agentId: agent.id, entries: [], error: String(err) };
            }
          }),
        );
        if (cancelled) return;

        for (const { agentId, entries } of results) {
          for (const entry of entries) {
            const existing = aggregated.get(entry.dir_name);
            if (existing) {
              if (!existing.foundIn.includes(agentId)) existing.foundIn.push(agentId);
            } else {
              aggregated.set(entry.dir_name, {
                dirName: entry.dir_name,
                path: entry.path,
                foundIn: [agentId],
              });
            }
          }
        }

        const list = Array.from(aggregated.values()).sort((a, b) =>
          a.dirName.localeCompare(b.dirName),
        );
        setItems(list);
        // 默认全选，每条按 foundIn 预勾选
        setSelectedDirs(new Set(list.map((entry) => entry.dirName)));
        setAppsByDir(
          Object.fromEntries(
            list.map((entry) => [
              entry.dirName,
              SKILL_AGENTS.reduce<AppsSelection>(
                (acc, agent) => ({ ...acc, [agent.id]: entry.foundIn.includes(agent.id) }),
                { ...EMPTY_APPS },
              ),
            ]),
          ),
        );
      } catch (err) {
        if (cancelled) return;
        setError(String(err));
        setItems([]);
        setSelectedDirs(new Set());
        setAppsByDir({});
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open]);

  const allSelected = items.length > 0 && selectedDirs.size === items.length;
  const hasItems = items.length > 0;

  const toggleSelect = (dirName: string) => {
    setSelectedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dirName)) next.delete(dirName);
      else next.add(dirName);
      return next;
    });
  };

  const toggleAll = (checked: boolean) => {
    setSelectedDirs(checked ? new Set(items.map((entry) => entry.dirName)) : new Set());
  };

  const toggleApp = (dirName: string, agentId: SkillAgentId) => {
    setAppsByDir((prev) => ({
      ...prev,
      [dirName]: {
        ...(prev[dirName] ?? { ...EMPTY_APPS }),
        [agentId]: !(prev[dirName]?.[agentId] ?? false),
      },
    }));
  };

  const totalAgentCalls = useMemo(() => {
    let count = 0;
    for (const dirName of selectedDirs) {
      const apps = appsByDir[dirName];
      if (!apps) continue;
      for (const agent of SKILL_AGENTS) {
        if (apps[agent.id]) count += 1;
      }
    }
    return count;
  }, [selectedDirs, appsByDir]);

  const handleImport = async () => {
    if (selectedDirs.size === 0) return;
    setError(null);
    setImporting(true);
    try {
      // 后端按 (agent_id, dir_names[]) 接收，所以把所有用户选中的 (skill, agent)
      // 分组成 agent_id -> dir_names[]，再分别调用。
      const byAgent = new Map<SkillAgentId, string[]>();
      for (const dirName of selectedDirs) {
        const apps = appsByDir[dirName];
        if (!apps) continue;
        for (const agent of SKILL_AGENTS) {
          if (!apps[agent.id]) continue;
          const list = byAgent.get(agent.id) ?? [];
          list.push(dirName);
          byAgent.set(agent.id, list);
        }
      }

      for (const [agentId, dirNames] of byAgent) {
        await skillsService.importSkillsFromApps({
          agent_id: agentId,
          dir_names: dirNames,
        });
      }
      onImported?.();
      onOpenChange(false);
    } catch (err) {
      setError(String(err));
    } finally {
      setImporting(false);
    }
  };

  const helperText = useMemo(() => {
    if (loading) return t('skills.importUnmanaged.scanning', '正在扫描所有 Agent...');
    if (error) return error;
    if (!hasItems) {
      return t('skills.importUnmanaged.empty', '没有找到可导入的 Skills');
    }
    return t('skills.importUnmanaged.found', `发现 ${items.length} 个未管理 Skill`, {
      count: items.length,
    });
  }, [loading, error, hasItems, items.length, t]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl gap-3 p-5">
        <DialogHeader>
          <DialogTitle>{t('skills.importUnmanaged.title', '导入已有 Skills')}</DialogTitle>
          <DialogDescription>
            {t(
              'skills.importUnmanaged.desc',
              '从各 Agent 的本地目录扫描已存在但尚未纳入管理的 Skills，统一导入到号小管。',
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between text-[12px] text-muted-foreground">
          <span className={cn(error && 'text-destructive')}>{helperText}</span>
          {hasItems ? (
            <label className="inline-flex cursor-pointer items-center gap-2">
              <Checkbox
                checked={allSelected}
                onCheckedChange={(checked) => toggleAll(Boolean(checked))}
              />
              <span>{t('skills.importUnmanaged.selectAll', '全选')}</span>
            </label>
          ) : null}
        </div>

        <ScrollArea className="h-[360px] -mx-1">
          {loading ? (
            <div className="flex flex-col gap-2 px-1">
              {Array.from({ length: 4 }).map((_, idx) => (
                <Skeleton key={idx} className="h-20 rounded-[8px]" />
              ))}
            </div>
          ) : hasItems ? (
            <ul className="flex flex-col gap-1.5 px-1">
              {items.map((entry) => {
                const checked = selectedDirs.has(entry.dirName);
                const apps = appsByDir[entry.dirName] ?? EMPTY_APPS;
                return (
                  <li
                    key={entry.dirName}
                    className={cn(
                      'rounded-[8px] border border-border bg-card px-3 py-2.5 transition-colors',
                      checked ? 'border-primary/30 bg-primary/[0.04]' : 'hover:bg-muted/40',
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <Checkbox
                        className="mt-1"
                        checked={checked}
                        onCheckedChange={() => toggleSelect(entry.dirName)}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-medium text-foreground">
                          {entry.dirName}
                        </div>
                        <div
                          className="mt-0.5 truncate text-[11.5px] text-muted-foreground"
                          title={entry.path}
                        >
                          {entry.path}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          {SKILL_AGENTS.map((agent) => {
                            const enabled = apps[agent.id];
                            const disabled = !checked;
                            return (
                              <button
                                key={agent.id}
                                type="button"
                                disabled={disabled}
                                onClick={() => toggleApp(entry.dirName, agent.id)}
                                aria-pressed={enabled}
                                className={cn(
                                  'inline-flex h-7 items-center gap-1.5 rounded-[6px] border px-2 text-[12px] transition-colors disabled:opacity-50',
                                  enabled
                                    ? 'border-primary/30 bg-primary/8 text-primary'
                                    : 'border-border bg-card text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                                )}
                              >
                                <AgentLogo
                                  agentId={agent.id}
                                  className="size-4 rounded-[4px] border-0 bg-transparent shadow-none"
                                  imageClassName="size-3.5"
                                />
                                <span>{agent.label}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-10 text-center">
              <FolderSearch className="size-8 text-muted-foreground/70" strokeWidth={1.6} aria-hidden />
              <p className="text-[13px] font-medium text-foreground">
                {error ?? t('skills.importUnmanaged.empty', '没有找到可导入的 Skills')}
              </p>
              <p className="text-[12px] text-muted-foreground">
                {t('skills.importUnmanaged.emptyHint', '当各 Agent 本地有现成 Skill 时会显示在这里。')}
              </p>
            </div>
          )}
        </ScrollArea>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={importing}>
            {t('common.cancel', '取消')}
          </Button>
          <Button
            onClick={handleImport}
            disabled={selectedDirs.size === 0 || importing || loading || totalAgentCalls === 0}
          >
            {importing ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {importing
              ? t('skills.importUnmanaged.importing', '导入中...')
              : t('skills.importUnmanaged.confirm', `导入 (${selectedDirs.size})`, {
                  count: selectedDirs.size,
                })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
