import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  MessageSquare,
  RefreshCw,
  Search,
  SquareCheck,
  Trash2,
  Wrench,
} from 'lucide-react';
import { useSessionsStore, CLIENT_TO_TOOL } from '../stores/sessionsStore';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { ManagementSearchField } from '@/components/management/ManagementControls';
import { cn } from '@/lib/utils';
import type { SessionSummaryDto } from '@shared/api-types';
import { TOOL_CONFIG, formatTime, shortDir, SessionListSkeleton, EmptyState } from '@/components/sessions/shared';
import { SessionDetailDialog } from '@/components/sessions/SessionDetailDialog';
import { RepairSessionsDialog } from '@/components/sessions/RepairSessionsDialog';
import { ProviderTag, providerLabel } from '@/components/sessions/ProviderTag';
import { StatusBadge } from '@/components/sessions/StatusBadge';
import { ClientLogo } from '@/components/clientConfig/ClientLogo';
import { clientStatus } from '@/components/clientConfig/clientStatus';

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
  onDelete,
}: {
  session: SessionSummaryDto;
  active: boolean;
  selectMode: boolean;
  checked: boolean;
  onSelect: () => void;
  onCheck: (checked: boolean) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation('nav');
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
        {selectMode ? (
          /* 选择模式：保留原有简洁布局 */
          <>
            <div className="flex items-center gap-1.5">
              <span className="truncate text-[13px] font-semibold leading-5 text-foreground">
                {session.title ?? session.sessionId}
              </span>
              <ProviderTag provider={session.provider} />
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
          </>
        ) : (
          /* 非选择模式：codex++ 布局 */
          <>
            {/* 第一行：标题（粗） */}
            <div className="truncate text-[13px] font-semibold leading-5 text-foreground">
              {session.title ?? session.sessionId}
            </div>
            {/* 第二行：sessionId（mono 小字） */}
            <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
              {session.sessionId}
            </div>
            {/* 第三行：projectDir */}
            {session.projectDir && (
              <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                {shortDir(session.projectDir)}
              </div>
            )}
          </>
        )}
      </div>

      {/* 右元区（非选择模式） */}
      {!selectMode && (
        <div className="flex shrink-0 flex-col items-end gap-1">
          {/* 第一行：状态徽章 */}
          <StatusBadge archived={session.archived} />
          {/* 第二行：provider */}
          <span className="text-[10px] text-muted-foreground">
            {session.provider ? providerLabel(session.provider) : t('sessionsView.providerUnknown')}
          </span>
          {/* 第三行：时间 */}
          {session.lastActiveAt && (
            <span className="text-[10px] text-muted-foreground">
              {formatTime(session.lastActiveAt)}
            </span>
          )}
        </div>
      )}

      {/* 行尾删除按钮（非选择模式） */}
      {!selectMode && (
        <div
          className="shrink-0 self-center"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <Button
            variant="ghost"
            size="icon"
            className="size-7 rounded-[7px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive"
            aria-label={t('sessionsView.delete')}
            onClick={onDelete}
          >
            <Trash2 className="size-3.5" strokeWidth={1.9} />
          </Button>
        </div>
      )}
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
    selectedPath,
    messages,
    loading,
    error,
    init,
    selectClient,
    loadMore,
    selectSession,
    deleteSession,
    resume,
    deleteSelected,
    refresh,
    clients,
    activeClient,
    versions,
  } = useSessionsStore();

  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // 详情弹窗
  const [detailOpen, setDetailOpen] = useState(false);
  // 修复会话弹窗（Task 12 才实现，本任务保留 state 与按钮 onClick）
  const [repairOpen, setRepairOpen] = useState(false);

  // AlertDialog 状态
  const [deleteTarget, setDeleteTarget] = useState<SessionSummaryDto | null>(null);
  const [showBatchDelete, setShowBatchDelete] = useState(false);

  // 无限滚动：ScrollArea viewport ref + sentinel ref
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 延迟到首帧绘制后再发起加载：点击导航即时显示页面（含骨架），不阻塞导航。
    // init 幂等，反复进出会话页时为 no-op（直接用缓存）。
    const id = requestAnimationFrame(() => void init());
    return () => cancelAnimationFrame(id);
  }, [init]);

  useEffect(() => {
    if (error) toast.error(error);
  }, [error]);

  const cur = byTool[activeTool];
  const items = cur?.items ?? [];
  const hasMore = cur ? cur.offset < cur.total : false;
  const selectedSession = items.find((i) => i.sourcePath === selectedPath) ?? null;
  // 当前工具总数：已扫描用 byTool.total，否则用 probe.count（无需扫描内容）。
  const activeTotal = cur?.total ?? probes.find((p) => p.tool === activeTool)?.count;
  // 当前选中的客户端信息
  const activeInfo = clients.find((c) => c.clientId === activeClient);

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
    // 若删的是当前弹窗中的会话，关闭弹窗
    if (deleteTarget.sourcePath === selectedPath) setDetailOpen(false);
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

  // 当前客户端是否有会话源（opencode/openclaw/hermes 无）
  const currentClientHasTool = !!CLIENT_TO_TOOL[activeClient];

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-[calc(100vh-96px)] w-full overflow-hidden bg-card">
        {/* ── 左栏：客户端 agent 列表 ── */}
        <aside className="flex h-full min-h-0 w-[200px] shrink-0 flex-col border-r border-border/80 px-3 py-4">
          <div className="px-1 text-[12px] font-medium text-foreground/70">
            {t('clientConfigPage.clients')}
          </div>
          <ScrollArea className="mt-2 min-h-0 flex-1 pr-1">
            <nav className="flex min-w-0 flex-col gap-1" aria-label={t('clientConfigPage.clients')}>
              {clients.map((c) => {
                const selected = c.clientId === activeClient;
                const tool = CLIENT_TO_TOOL[c.clientId];
                const n = tool
                  ? (byTool[tool]?.total ?? probes.find((p) => p.tool === tool)?.count)
                  : undefined;
                const status = clientStatus(c.detected, versions[c.clientId], t);
                return (
                  <button
                    key={c.clientId}
                    type="button"
                    onClick={() => {
                      setQuery('');
                      setSearchOpen(false);
                      setSelectMode(false);
                      setSelected(new Set());
                      void selectClient(c.clientId);
                    }}
                    className={cn(
                      'flex h-11 w-full min-w-0 items-center gap-2.5 rounded-[8px] px-2 text-left transition-colors',
                      selected ? 'bg-primary/10' : 'hover:bg-muted',
                    )}
                  >
                    <ClientLogo clientId={c.clientId} />
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          'block truncate text-[12.5px] font-medium',
                          selected ? 'text-primary' : 'text-foreground',
                        )}
                      >
                        {c.displayName}
                      </span>
                      <span className="flex items-center gap-1 text-[10px] text-muted-foreground" title={status.title}>
                        <span
                          className={cn('size-1.5 rounded-full', status.dotClass)}
                          aria-hidden
                        />
                        {status.label}
                      </span>
                    </span>
                    {n != null ? (
                      <span className="shrink-0 rounded-[6px] bg-muted px-1.5 text-[10px] text-muted-foreground">
                        {n}
                      </span>
                    ) : (
                      <span className="shrink-0 text-[10px] text-muted-foreground/50">—</span>
                    )}
                  </button>
                );
              })}
            </nav>
          </ScrollArea>
        </aside>

        {/* ── 右栏：工具条 + 会话列表 ── */}
        <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {!currentClientHasTool ? (
            /* 无会话源的客户端（opencode/openclaw/hermes） */
            <EmptyState
              icon={MessageSquare}
              title={t('sessionsView.unsupportedTitle')}
              subtitle={t('sessionsView.unsupportedSub')}
            />
          ) : (
            <>
              {/* ── 顶部工具条 ── */}
              <div className="shrink-0 border-b border-border/60 px-4 py-2.5">
                <div className="flex items-center gap-1.5">
                  {/* 标题 + 总数 */}
                  <span className="text-[13px] font-semibold text-foreground">
                    {activeInfo?.displayName ?? t('sessions')}
                  </span>
                  {activeTotal != null && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                      {activeTotal}
                    </span>
                  )}

                  {/* 右侧 icon 按钮组 */}
                  <div className="ml-auto flex items-center gap-0.5">
                    {/* 修复会话：仅 codex 显示 */}
                    {activeClient === 'codex' && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 rounded-[7px] text-muted-foreground hover:text-foreground"
                            aria-label={t('sessionsView.repair')}
                            onClick={() => setRepairOpen(true)}
                          >
                            <Wrench className="size-3.5" strokeWidth={1.9} />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">{t('sessionsView.repair')}</TooltipContent>
                      </Tooltip>
                    )}

                    {/* 批量选择 */}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className={cn(
                            'size-7 rounded-[7px] text-muted-foreground hover:text-foreground',
                            selectMode &&
                              'bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary',
                          )}
                          aria-label={
                            selectMode
                              ? t('sessionsView.batchCancel')
                              : t('sessionsView.batchToggle')
                          }
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
                            searchOpen &&
                              'bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary',
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

              {/* ── 会话列表区域（无限滚动） ── */}
              <ScrollArea ref={scrollAreaRef} className="min-h-0 flex-1 px-1">
                {!cur?.loaded ? (
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
                  <div className="flex flex-col gap-px px-1 py-1">
                    {filtered.map((s) => (
                      <SessionRow
                        key={s.sourcePath}
                        session={s}
                        active={s.sourcePath === selectedPath && !selectMode}
                        selectMode={selectMode}
                        checked={selected.has(s.sourcePath)}
                        onSelect={() => {
                          if (!selectMode) {
                            void selectSession(s);
                            setDetailOpen(true);
                          }
                        }}
                        onCheck={(checked) => {
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (checked) next.add(s.sourcePath);
                            else next.delete(s.sourcePath);
                            return next;
                          });
                        }}
                        onDelete={() => setDeleteTarget(s)}
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
            </>
          )}
        </section>
      </div>

      {/* ── 详情弹窗 ── */}
      <SessionDetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        session={selectedSession}
        messages={messages}
        loading={loading}
        roleLabel={roleLabel}
        onResume={(s) => void onResume(s)}
        onCopy={(s) => void copyResume(s)}
        onDelete={(s) => setDeleteTarget(s)}
      />

      {/* ── 修复会话对话框 ── */}
      <RepairSessionsDialog open={repairOpen} onOpenChange={setRepairOpen} />

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
            <AlertDialogTitle>{t('sessionsView.confirmDeleteBatchTitle')}</AlertDialogTitle>
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
