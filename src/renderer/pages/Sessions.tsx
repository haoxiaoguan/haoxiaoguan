import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  Bot,
  ChevronDown,
  Copy,
  FolderOpen,
  MessageSquare,
  Play,
  RefreshCw,
  Search,
  SquareCheck,
  Trash2,
} from 'lucide-react';
import { useSessionsStore, TOOLS } from '../stores/sessionsStore';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import { ManagementSearchField } from '@/components/management/ManagementControls';
import { cn } from '@/lib/utils';
import type { SessionSummaryDto, SessionMessageDto } from '@shared/api-types';

// 工具色调配置
const TOOL_CONFIG: Record<string, { color: string; label: string; dotColor: string }> = {
  claude: {
    color: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
    label: 'Claude Code',
    dotColor: 'bg-orange-500',
  },
  codex: {
    color: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
    label: 'Codex',
    dotColor: 'bg-blue-500',
  },
  gemini: {
    color: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    label: 'Gemini CLI',
    dotColor: 'bg-emerald-500',
  },
};

function toolLabel(tool: string): string {
  return TOOL_CONFIG[tool]?.label ?? tool;
}

// 时间格式化
function formatTime(val?: string | number | null): string {
  if (val == null) return '';
  const d = typeof val === 'number' ? new Date(val) : new Date(val);
  if (Number.isNaN(d.getTime())) return '';
  const now = Date.now();
  const diff = now - d.getTime();
  const minutes = Math.round(diff / 60_000);
  if (minutes < 2) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.round(hours / 24)} 天前`;
}

// 目录缩短显示
function shortDir(dir?: string | null): string {
  if (!dir) return '';
  const parts = dir.replace(/\\/g, '/').split('/');
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : dir;
}

// ──────────────────────────────────────────────
// 骨架屏
// ──────────────────────────────────────────────
function SessionListSkeleton() {
  return (
    <div className="flex flex-col gap-px px-2 py-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-start gap-3 rounded-[8px] px-3 py-3">
          <Skeleton className="size-7 shrink-0 rounded-[7px]" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3.5 w-4/5 rounded" />
            <Skeleton className="h-3 w-3/5 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ──────────────────────────────────────────────
// 空态
// ──────────────────────────────────────────────
function EmptyState({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: typeof MessageSquare;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6">
      <div className="flex size-10 items-center justify-center rounded-full bg-muted">
        <Icon className="size-5 text-muted-foreground" strokeWidth={1.85} />
      </div>
      <div className="space-y-1 text-center">
        <p className="text-[13px] font-medium text-foreground">{title}</p>
        <p className="text-[11.5px] text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────
// 消息角色徽章
// ──────────────────────────────────────────────
const ROLE_STYLE: Record<string, string> = {
  user: 'bg-primary/10 text-primary',
  assistant: 'bg-muted text-muted-foreground',
  tool: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  system: 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400',
};

function RoleBadge({ role, label }: { role: string; label: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-[5px] px-1.5 py-0.5 text-[10.5px] font-semibold',
        ROLE_STYLE[role] ?? ROLE_STYLE['system'],
      )}
    >
      <span
        className={cn(
          'size-1.5 rounded-full',
          role === 'user'
            ? 'bg-primary'
            : role === 'assistant'
              ? 'bg-muted-foreground/50'
              : role === 'tool'
                ? 'bg-amber-500'
                : 'bg-zinc-400',
        )}
        aria-hidden
      />
      {label}
    </span>
  );
}

// ──────────────────────────────────────────────
// 消息气泡
// ──────────────────────────────────────────────
const BUBBLE_STYLE: Record<string, string> = {
  user: 'bg-primary/10 border-primary/20',
  assistant: 'bg-card border-border/60',
  tool: 'bg-muted/50 border-border/40',
  system: 'bg-muted/30 border-border/30',
};

function MessageBubble({
  msg,
  roleLabel,
}: {
  msg: SessionMessageDto;
  roleLabel: string;
}) {
  const isToolCall = msg.role === 'tool' || msg.content?.startsWith('[Tool:');
  return (
    <div
      className={cn(
        'rounded-[10px] border px-3.5 py-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]',
        BUBBLE_STYLE[msg.role] ?? BUBBLE_STYLE['system'],
      )}
    >
      <div className="mb-1.5">
        <RoleBadge role={msg.role} label={roleLabel} />
      </div>
      <div
        className={cn(
          'whitespace-pre-wrap break-words text-[12.5px] leading-relaxed',
          isToolCall ? 'font-mono text-muted-foreground' : 'text-foreground',
        )}
      >
        {msg.content}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────
// 列表行
// ──────────────────────────────────────────────
function SessionRow({
  session,
  active,
  selectMode,
  checked,
  onSelect,
  onCheck,
}: {
  session: SessionSummaryDto;
  active: boolean;
  selectMode: boolean;
  checked: boolean;
  onSelect: () => void;
  onCheck: (checked: boolean) => void;
}) {
  const toolCfg = TOOL_CONFIG[session.tool] ?? {
    color: 'bg-muted text-muted-foreground',
    label: session.tool,
    dotColor: 'bg-muted-foreground',
  };

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'group relative flex w-full items-start gap-3 rounded-[8px] px-3 py-3 text-left transition-colors',
        active
          ? 'border-l-[3px] border-l-primary bg-primary/10 pl-[calc(0.75rem-2px)]'
          : 'hover:bg-muted/40',
      )}
    >
      {/* 选择框 / 工具色点 */}
      {selectMode ? (
        <div
          className="mt-0.5 shrink-0"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <Checkbox
            checked={checked}
            onCheckedChange={onCheck}
            aria-label={`选择会话 ${session.title ?? session.sessionId}`}
          />
        </div>
      ) : (
        <div
          className={cn(
            'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-[7px] text-[10px] font-bold',
            toolCfg.color,
          )}
          aria-hidden
        >
          {toolCfg.label.charAt(0)}
        </div>
      )}

      {/* 文字内容 */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[13px] font-semibold leading-5 text-foreground">
            {session.title ?? session.sessionId}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
          {session.projectDir && (
            <span className="truncate">{shortDir(session.projectDir)}</span>
          )}
          {session.projectDir && session.lastActiveAt && (
            <span className="shrink-0 text-border">·</span>
          )}
          {session.lastActiveAt && (
            <span className="shrink-0">{formatTime(session.lastActiveAt)}</span>
          )}
        </div>
      </div>
    </button>
  );
}

// ──────────────────────────────────────────────
// 主页面
// ──────────────────────────────────────────────
export default function Sessions() {
  const { t } = useTranslation('nav');
  const {
    probes,
    activeTool,
    byTool,
    selectedId,
    messages,
    loading,
    error,
    init,
    selectTool,
    loadMore,
    selectSession,
    deleteSession,
    resume,
    deleteSelected,
    refresh,
  } = useSessionsStore();

  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // AlertDialog 状态
  const [deleteTarget, setDeleteTarget] = useState<SessionSummaryDto | null>(null);
  const [showBatchDelete, setShowBatchDelete] = useState(false);

  // 无限滚动：ScrollArea viewport ref + sentinel ref
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    if (error) toast.error(error);
  }, [error]);

  const cur = byTool[activeTool];
  const items = cur?.items ?? [];
  const hasMore = cur ? cur.offset < cur.total : false;
  const selectedSession = items.find((i) => i.sessionId === selectedId);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((s) =>
      [s.title, s.summary, s.projectDir, s.sessionId].some((f) =>
        f?.toLowerCase().includes(q),
      ),
    );
  }, [items, query]);

  // IntersectionObserver：sentinel 进入视口时触发 loadMore
  const handleLoadMore = useCallback(() => {
    if (hasMore && !loading) void loadMore();
  }, [hasMore, loading, loadMore]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    // 找 Radix ScrollArea 的内部滚动视口
    const viewport = scrollAreaRef.current?.querySelector(
      '[data-radix-scroll-area-viewport]',
    ) as HTMLElement | null;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) handleLoadMore();
      },
      { root: viewport ?? null, rootMargin: '0px 0px 80px 0px', threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [handleLoadMore]);

  // 复制恢复命令
  const copyResume = async (s: SessionSummaryDto) => {
    if (!s.resumeCommand) return;
    const cmd = s.projectDir ? `cd "${s.projectDir}" && ${s.resumeCommand}` : s.resumeCommand;
    try {
      await navigator.clipboard.writeText(cmd);
      toast.success(cmd);
    } catch {
      toast.error(cmd);
    }
  };

  const onResume = async (s: SessionSummaryDto) => {
    try {
      await resume(s);
      toast.success(t('sessions'));
    } catch {
      void copyResume(s);
    }
  };

  // 批量删除执行
  const executeBatchDelete = () => {
    void deleteSelected(filtered.filter((s) => selected.has(s.sourcePath)));
    setSelected(new Set());
    setSelectMode(false);
    setShowBatchDelete(false);
  };

  // 单条删除执行
  const executeSingleDelete = () => {
    if (!deleteTarget) return;
    void deleteSession(deleteTarget);
    setDeleteTarget(null);
  };

  // 角色标签中文化
  const roleLabel = (role: string) => {
    const map: Record<string, string> = {
      user: t('sessionsView.roleUser'),
      assistant: t('sessionsView.roleAssistant'),
      tool: t('sessionsView.roleTool'),
      system: t('sessionsView.roleSystem'),
    };
    return map[role] ?? role;
  };

  // 当前工具色配置
  const activeCfg = TOOL_CONFIG[activeTool] ?? {
    color: 'bg-muted text-muted-foreground',
    label: activeTool,
    dotColor: 'bg-muted-foreground',
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-[calc(100vh-96px)] w-full overflow-hidden bg-card">
        {/* ── 左栏：列表 ── */}
        <aside className="flex h-full min-h-0 w-[300px] shrink-0 flex-col border-r border-border/80">
          {/* ── 表头行 ── */}
          <div className="shrink-0 border-b border-border/60 px-3 py-2">
            <div className="flex items-center gap-1.5">
              {/* 标题 + 总数徽章 */}
              <span className="text-[12.5px] font-semibold text-foreground">
                {t('sessions')}
              </span>
              {cur?.total != null && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                  {cur.total}
                </span>
              )}

              {/* 右侧 icon 按钮组 */}
              <div className="ml-auto flex items-center gap-0.5">
                {/* 批量选择 */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className={cn(
                        'size-7 rounded-[7px] text-muted-foreground hover:text-foreground',
                        selectMode && 'bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary',
                      )}
                      aria-label={selectMode ? t('sessionsView.batchCancel') : t('sessionsView.batchToggle')}
                      onClick={() => {
                        setSelectMode((v) => !v);
                        setSelected(new Set());
                      }}
                    >
                      <SquareCheck className="size-3.5" strokeWidth={1.9} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {selectMode ? t('sessionsView.batchCancel') : t('sessionsView.batchToggle')}
                  </TooltipContent>
                </Tooltip>

                {/* 搜索切换 */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className={cn(
                        'size-7 rounded-[7px] text-muted-foreground hover:text-foreground',
                        searchOpen && 'bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary',
                      )}
                      aria-label={t('sessionsView.searchToggle')}
                      onClick={() => {
                        setSearchOpen((v) => {
                          if (v) setQuery('');
                          return !v;
                        });
                      }}
                    >
                      <Search className="size-3.5" strokeWidth={1.9} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">{t('sessionsView.searchToggle')}</TooltipContent>
                </Tooltip>

                {/* 工具切换下拉 */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    {/* 包一层 div 避免 Tooltip + Select 冲突 */}
                    <div>
                      <Select
                        value={activeTool}
                        onValueChange={(v) => {
                          void selectTool(v as typeof activeTool);
                          setQuery('');
                          setSearchOpen(false);
                          setSelectMode(false);
                          setSelected(new Set());
                        }}
                      >
                        <SelectTrigger
                          className={cn(
                            'h-7 gap-0.5 rounded-[7px] border-0 bg-transparent px-1.5 text-[11.5px] shadow-none focus:ring-0',
                            activeCfg.color,
                          )}
                          aria-label={t('sessionsView.toolSelect')}
                        >
                          <span
                            className={cn('size-2 shrink-0 rounded-full', activeCfg.dotColor)}
                            aria-hidden
                          />
                          <ChevronDown className="size-3 opacity-60" strokeWidth={1.9} />
                        </SelectTrigger>
                        <SelectContent align="end" className="min-w-[170px]">
                          {TOOLS.map((tool) => {
                            const cfg = TOOL_CONFIG[tool] ?? {
                              color: 'bg-muted text-muted-foreground',
                              label: tool,
                              dotColor: 'bg-muted-foreground',
                            };
                            const probe = probes.find((p) => p.tool === tool);
                            const count = byTool[tool]?.total ?? 0;
                            const hasNone = probe?.hasSessions === false || count === 0;
                            return (
                              <SelectItem
                                key={tool}
                                value={tool}
                                disabled={hasNone}
                                className="text-[12.5px]"
                              >
                                <div className="flex items-center gap-2">
                                  <span
                                    className={cn('size-2 shrink-0 rounded-full', cfg.dotColor)}
                                    aria-hidden
                                  />
                                  <span>{cfg.label}</span>
                                  {count > 0 && (
                                    <span className="ml-auto pl-3 text-[11px] text-muted-foreground">
                                      {count}
                                    </span>
                                  )}
                                  {hasNone && (
                                    <span className="ml-auto pl-3 text-[11px] text-muted-foreground">
                                      0
                                    </span>
                                  )}
                                </div>
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">{t('sessionsView.toolSelect')}</TooltipContent>
                </Tooltip>

                {/* 刷新 */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 rounded-[7px] text-muted-foreground hover:text-foreground"
                      aria-label={t('sessionsView.refresh')}
                      disabled={loading}
                      onClick={() => void refresh()}
                    >
                      <RefreshCw
                        className={cn('size-3.5', loading && 'animate-spin')}
                        strokeWidth={1.9}
                      />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">{t('sessionsView.refresh')}</TooltipContent>
                </Tooltip>
              </div>
            </div>

            {/* 搜索栏（展开时显示） */}
            {searchOpen && (
              <div className="mt-2">
                <ManagementSearchField
                  value={query}
                  onChange={setQuery}
                  placeholder={t('sessionsView.search')}
                />
              </div>
            )}

            {/* 批量模式：删除按钮行 */}
            {selectMode && selected.size > 0 && (
              <div className="mt-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 w-full rounded-[7px] px-2.5 text-[11.5px] text-destructive hover:text-destructive"
                  onClick={() => setShowBatchDelete(true)}
                >
                  {t('sessionsView.batchDelete', { count: selected.size })}
                </Button>
              </div>
            )}
          </div>

          {/* 列表区域（无限滚动） */}
          <ScrollArea ref={scrollAreaRef} className="min-h-0 flex-1 px-1">
            {loading && items.length === 0 ? (
              <SessionListSkeleton />
            ) : filtered.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 py-12 text-center">
                <MessageSquare
                  className="size-8 text-muted-foreground/40"
                  strokeWidth={1.5}
                />
                <div>
                  <p className="text-[12.5px] font-medium text-muted-foreground">
                    {query ? t('sessionsView.emptySearch') : t('sessionsView.emptyList')}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground/70">
                    {query
                      ? t('sessionsView.emptySearchSub')
                      : t('sessionsView.emptyListSub')}
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-px py-1 px-1">
                {filtered.map((s) => (
                  <SessionRow
                    key={s.sourcePath}
                    session={s}
                    active={s.sessionId === selectedId && !selectMode}
                    selectMode={selectMode}
                    checked={selected.has(s.sourcePath)}
                    onSelect={() => {
                      if (!selectMode) void selectSession(s);
                    }}
                    onCheck={(checked) => {
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (checked) next.add(s.sourcePath);
                        else next.delete(s.sourcePath);
                        return next;
                      });
                    }}
                  />
                ))}

                {/* 无限滚动 sentinel */}
                <div ref={sentinelRef} className="h-px w-full" aria-hidden />

                {/* 加载中 spinner */}
                {loading && items.length > 0 && (
                  <div className="flex justify-center py-3">
                    <div className="size-4 animate-spin rounded-full border-2 border-muted-foreground border-t-foreground" />
                  </div>
                )}
              </div>
            )}
          </ScrollArea>
        </aside>

        {/* ── 右栏：详情 ── */}
        <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {selectedSession ? (
            <>
              {/* 详情头部 */}
              <div className="shrink-0 border-b border-border/80 px-5 py-3.5">
                <div className="flex min-w-0 items-start justify-between gap-3">
                  {/* 标题 + 目录 */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-[8px] bg-primary/10">
                        <Bot className="size-4 text-primary" strokeWidth={1.85} />
                      </div>
                      <h2 className="truncate text-[14px] font-semibold leading-6 text-foreground">
                        {selectedSession.title ?? selectedSession.sessionId}
                      </h2>
                      {/* 工具 badge */}
                      <Badge
                        className={cn(
                          'shrink-0 h-5 border-transparent px-1.5 text-[11px]',
                          TOOL_CONFIG[selectedSession.tool]?.color ??
                            'bg-muted text-muted-foreground',
                        )}
                      >
                        {toolLabel(selectedSession.tool)}
                      </Badge>
                    </div>

                    {/* 目录 chip */}
                    {selectedSession.projectDir && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="mt-1.5 ml-10 inline-flex items-center gap-1.5 rounded-[6px] bg-muted/50 px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            onClick={() =>
                              selectedSession.projectDir &&
                              void navigator.clipboard.writeText(selectedSession.projectDir)
                            }
                          >
                            <FolderOpen className="size-3 shrink-0" strokeWidth={1.8} />
                            <span className="max-w-[320px] truncate">
                              {selectedSession.projectDir}
                            </span>
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">
                          {t('sessionsView.copyDir')}
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </div>

                  {/* 操作按钮组 */}
                  <div className="flex shrink-0 items-center gap-1.5">
                    {selectedSession.resumeCommand && (
                      <>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 rounded-[8px] px-3 text-[12px] gap-1.5"
                              onClick={() => void onResume(selectedSession)}
                            >
                              <Play className="size-3.5" strokeWidth={1.9} />
                              {t('sessionsView.resume')}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{t('sessionsView.resume')}</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8 rounded-[8px] text-muted-foreground hover:text-foreground"
                              aria-label={t('sessionsView.copyCmd')}
                              onClick={() => void copyResume(selectedSession)}
                            >
                              <Copy className="size-3.5" strokeWidth={1.9} />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{t('sessionsView.copyCmd')}</TooltipContent>
                        </Tooltip>
                      </>
                    )}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 rounded-[8px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          aria-label={t('sessionsView.delete')}
                          onClick={() => setDeleteTarget(selectedSession)}
                        >
                          <Trash2 className="size-3.5" strokeWidth={1.9} />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t('sessionsView.delete')}</TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              </div>

              {/* 消息时间线 */}
              <ScrollArea className="min-h-0 flex-1">
                <div className="flex flex-col gap-3 px-5 py-4">
                  {messages.length === 0 && loading ? (
                    <div className="flex items-center justify-center py-12">
                      <div className="size-6 animate-spin rounded-full border-2 border-muted-foreground border-t-foreground" />
                    </div>
                  ) : messages.length === 0 ? (
                    <EmptyState
                      icon={MessageSquare}
                      title={t('sessionsView.emptyDetail')}
                      subtitle={t('sessionsView.emptyDetailSub')}
                    />
                  ) : (
                    messages.map((m, i) => (
                      <MessageBubble key={i} msg={m} roleLabel={roleLabel(m.role)} />
                    ))
                  )}
                </div>
              </ScrollArea>
            </>
          ) : (
            /* 未选会话：右侧空态 */
            <EmptyState
              icon={MessageSquare}
              title={t('sessionsView.emptyDetail')}
              subtitle={t('sessionsView.emptyDetailSub')}
            />
          )}
        </section>
      </div>

      {/* ── 单条删除确认 ── */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('sessionsView.confirmDeleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('sessionsView.confirmDeleteDesc')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('sessionsView.cancelAction')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={executeSingleDelete}
            >
              {t('sessionsView.confirmAction')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── 批量删除确认 ── */}
      <AlertDialog open={showBatchDelete} onOpenChange={setShowBatchDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('sessionsView.confirmDeleteBatchTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('sessionsView.confirmDeleteBatchDesc', { count: selected.size })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('sessionsView.cancelAction')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={executeBatchDelete}
            >
              {t('sessionsView.confirmAction')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TooltipProvider>
  );
}
