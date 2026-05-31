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
import { mcpService } from '../../services/tauri';
import type { UnmanagedMcpEntry } from '../../types';
import { AgentLogo, SKILL_AGENTS, type SkillAgentId } from '../skills/AgentLogo';

interface McpImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported?: () => void;
}

type AppsSelection = Record<SkillAgentId, boolean>;

const EMPTY_APPS: AppsSelection = {
  claude: false,
  codex: false,
  gemini: false,
  opencode: false,
  hermes: false,
};

function endpointText(entry: UnmanagedMcpEntry): string {
  const { spec } = entry;
  if (spec.transport === 'stdio') {
    return [spec.command, ...(spec.args ?? [])].filter(Boolean).join(' ');
  }
  return spec.url ?? '';
}

export function McpImportDialog({ open, onOpenChange, onImported }: McpImportDialogProps) {
  const { t } = useTranslation();
  const [items, setItems] = useState<UnmanagedMcpEntry[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [appsById, setAppsById] = useState<Record<string, AppsSelection>>({});
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
        const entries = await mcpService.scanUnmanagedMcp();
        if (cancelled) return;

        const list = [...entries].sort((a, b) => a.name.localeCompare(b.name));
        setItems(list);
        // 默认全选，每条按 found_in 预勾选 agent
        setSelectedIds(new Set(list.map((entry) => entry.id)));
        setAppsById(
          Object.fromEntries(
            list.map((entry) => [
              entry.id,
              SKILL_AGENTS.reduce<AppsSelection>(
                (acc, agent) => ({ ...acc, [agent.id]: entry.found_in.includes(agent.id) }),
                { ...EMPTY_APPS },
              ),
            ]),
          ),
        );
      } catch (err) {
        if (cancelled) return;
        setError(String(err));
        setItems([]);
        setSelectedIds(new Set());
        setAppsById({});
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open]);

  const allSelected = items.length > 0 && selectedIds.size === items.length;
  const hasItems = items.length > 0;

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = (checked: boolean) => {
    setSelectedIds(checked ? new Set(items.map((entry) => entry.id)) : new Set());
  };

  const toggleApp = (id: string, agentId: SkillAgentId) => {
    setAppsById((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] ?? { ...EMPTY_APPS }),
        [agentId]: !(prev[id]?.[agentId] ?? false),
      },
    }));
  };

  const totalAgentCalls = useMemo(() => {
    let count = 0;
    for (const id of selectedIds) {
      const apps = appsById[id];
      if (!apps) continue;
      for (const agent of SKILL_AGENTS) {
        if (apps[agent.id]) count += 1;
      }
    }
    return count;
  }, [selectedIds, appsById]);

  const handleImport = async () => {
    if (selectedIds.size === 0) return;
    setError(null);
    setImporting(true);
    try {
      const selections = Array.from(selectedIds)
        .map((id) => {
          const apps = appsById[id];
          const agent_ids = SKILL_AGENTS.filter((agent) => apps?.[agent.id]).map(
            (agent) => agent.id,
          );
          return { server_id: id, agent_ids };
        })
        .filter((sel) => sel.agent_ids.length > 0);

      await mcpService.importSelectedMcp(selections);
      onImported?.();
      onOpenChange(false);
    } catch (err) {
      setError(String(err));
    } finally {
      setImporting(false);
    }
  };

  const helperText = useMemo(() => {
    if (loading) return t('mcp.import.scanning', '正在扫描所有 Agent...');
    if (error) return error;
    if (!hasItems) return t('mcp.import.empty', '没有找到可导入的 MCP 服务');
    return t('mcp.import.found', `发现 ${items.length} 个未管理服务`, { count: items.length });
  }, [loading, error, hasItems, items.length, t]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl gap-3 p-5">
        <DialogHeader>
          <DialogTitle>{t('mcp.import.title', '导入已有 MCP 服务')}</DialogTitle>
          <DialogDescription>
            {t(
              'mcp.import.desc',
              '从各 Agent 的本地配置扫描已存在但尚未纳入管理的 MCP 服务，统一导入到号小管。',
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
              <span>{t('mcp.import.selectAll', '全选')}</span>
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
                const checked = selectedIds.has(entry.id);
                const apps = appsById[entry.id] ?? EMPTY_APPS;
                const endpoint = endpointText(entry);
                return (
                  <li
                    key={entry.id}
                    className={cn(
                      'rounded-[8px] border border-border bg-card px-3 py-2.5 transition-colors',
                      checked ? 'border-primary/30 bg-primary/[0.04]' : 'hover:bg-muted/40',
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <Checkbox
                        className="mt-1"
                        checked={checked}
                        onCheckedChange={() => toggleSelect(entry.id)}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-[13px] font-medium text-foreground">
                            {entry.name}
                          </span>
                          <span className="shrink-0 rounded-[5px] border border-border px-1 text-[10.5px] uppercase text-muted-foreground">
                            {entry.spec.transport}
                          </span>
                        </div>
                        {endpoint ? (
                          <div
                            className="mt-0.5 truncate font-mono text-[11.5px] text-muted-foreground"
                            title={endpoint}
                          >
                            {endpoint}
                          </div>
                        ) : null}
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          {SKILL_AGENTS.map((agent) => {
                            const enabled = apps[agent.id];
                            const disabled = !checked;
                            return (
                              <button
                                key={agent.id}
                                type="button"
                                disabled={disabled}
                                onClick={() => toggleApp(entry.id, agent.id)}
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
                {error ?? t('mcp.import.empty', '没有找到可导入的 MCP 服务')}
              </p>
              <p className="text-[12px] text-muted-foreground">
                {t('mcp.import.emptyHint', '当各 Agent 本地配置里有 MCP 服务时会显示在这里。')}
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
            disabled={selectedIds.size === 0 || importing || loading || totalAgentCalls === 0}
          >
            {importing ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {importing
              ? t('mcp.import.importing', '导入中...')
              : t('mcp.import.confirm', `导入 (${selectedIds.size})`, { count: selectedIds.size })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
