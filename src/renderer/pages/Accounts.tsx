import { useCallback, useEffect, useMemo, useRef, useState, forwardRef } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  Bell,
  LayoutGrid,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Table2,
  type LucideIcon,
  Upload,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  ManagementIconButton as HeaderIconButton,
  ManagementInfoPill as InfoPill,
  ManagementSearchField,
} from '@/components/management/ManagementControls';
import AddAccountSheet from '../components/AddAccountSheet';
import AccountCard from '../components/accounts/AccountCard';
import EditAccountDialog from '../components/accounts/EditAccountDialog';
import { PlatformSettingsDialog } from '../components/accounts/PlatformSettingsDialog';
import { AccountDataTable } from '../components/accounts/AccountDataTable';
import { PlatformIcon } from '../components/accounts/PlatformIcon';
import { primaryMetric } from '../components/accounts/quota-display';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useAccountStore, useHealthStore, usePlatformStore, useQuotaStateStore } from '../stores';
import { cn } from '@/lib/utils';
import type { Account, AccountQuotaState, AgentId } from '../types';

const ALL_PLATFORMS: AgentId[] = [
  'cursor',
  'windsurf',
  'antigravity',
  'kiro',
  'gemini-cli',
  'codex',
  'github-copilot',
  'codebuddy',
  'codebuddy-cn',
  'qoder',
  'trae',
  'zed',
];

const FILTER_ALL_TAGS = '__all__';
const PLATFORM_SORT_ORDER: AgentId[] = [
  'codex',
  'cursor',
  'windsurf',
  'antigravity',
  'gemini-cli',
  'github-copilot',
  'zed',
  'qoder',
  'trae',
  'codebuddy',
  'codebuddy-cn',
  'kiro',
];
const PLATFORM_SORT_INDEX = new Map<AgentId, number>(
  PLATFORM_SORT_ORDER.map((item, index) => [item, index]),
);

type ViewMode = 'card' | 'table';
type StatusFilter = 'all' | 'healthy' | 'warning' | 'pending';
type QuotaFilter = 'all' | 'ok' | 'warning' | 'unknown';
type SortMode = 'quota' | 'recent' | 'name';

const PLATFORM_DESCRIPTIONS: Record<string, string> = {
  cursor: '管理 Cursor 登录态、额度刷新与实例切换',
  windsurf: '管理 Windsurf 登录态、额度刷新与实例切换',
  antigravity: '管理 Antigravity IDE 登录态、额度刷新与实例切换',
  kiro: '管理 Kiro OAuth、设备凭据与 Credits',
  'gemini-cli': '管理 Gemini CLI 登录态与模型额度',
  codex: '管理 Codex CLI、API Key 与用量额度',
  'github-copilot': '管理 GitHub Copilot 账号、组织席位与设备码',
  codebuddy: '管理 CodeBuddy 国际版凭据与额度',
  'codebuddy-cn': '管理 CodeBuddy CN 凭据与额度',
  qoder: '管理 Qoder 登录态、额度刷新与实例切换',
  trae: '管理 Trae 登录态、额度刷新与实例切换',
  zed: '管理 Zed 登录态、Keychain 与用量额度',
};

export default function Accounts() {
  const { platform } = useParams<{ platform?: string }>();
  const { t } = useTranslation('accounts');
  const { t: tCommon } = useTranslation('translation');
  const { accounts, loading, fetchAccounts, switchAccount, deleteAccount, batchDelete } =
    useAccountStore();
  const detectActiveAccounts = useAccountStore((s) => s.detectActiveAccounts);
  const { getDisplayName, fetchPlatforms } = usePlatformStore();
  const { refreshBatch, snapshots } = useHealthStore();
  const quotaStates = useQuotaStateStore((s) => s.states);
  const ensureQuotaStates = useQuotaStateStore((s) => s.ensureMany);
  const refreshQuotaState = useQuotaStateStore((s) => s.refresh);

  const [selectedPlatform, setSelectedPlatform] = useState<AgentId>(
    isAgentId(platform) ? platform : PLATFORM_SORT_ORDER[0],
  );
  const [platformSearch, setPlatformSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [tagFilter, setTagFilter] = useState('');
  const [quotaFilter, setQuotaFilter] = useState<QuotaFilter>('all');
  const [sortMode, setSortMode] = useState<SortMode>('quota');
  const [searchText, setSearchText] = useState('');
  const [view, setView] = useState<ViewMode>('card');
  const [showImportSheet, setShowImportSheet] = useState(false);
  const [showPlatformSettings, setShowPlatformSettings] = useState(false);
  const [editTarget, setEditTarget] = useState<Account | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const switchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetchPlatforms();
    ALL_PLATFORMS.forEach((item) => fetchAccounts(item));
  }, [fetchAccounts, fetchPlatforms]);

  // On entering the page, reverse-detect which account each IDE is actually
  // logged into and reconcile the "in use" badges with reality. Best-effort.
  useEffect(() => {
    void detectActiveAccounts();
  }, [detectActiveAccounts]);

  useEffect(() => {
    if (isAgentId(platform)) setSelectedPlatform(platform);
  }, [platform]);

  useEffect(() => {
    setSelectedIds(new Set());
    setHighlightedId(null);
    setSearchText('');
    setTagFilter('');
    setStatusFilter('all');
    setQuotaFilter('all');
  }, [selectedPlatform]);

  const allAccounts = useMemo(() => {
    const out: Account[] = [];
    accounts.forEach((list) => out.push(...list));
    return out;
  }, [accounts]);

  useEffect(() => {
    const ids = allAccounts.map((account) => account.id);
    if (ids.length === 0) return;
    refreshBatch(ids).catch(() => {});
  }, [allAccounts, refreshBatch]);

  const platformCounts = useMemo(() => {
    const counts = new Map<AgentId, number>();
    ALL_PLATFORMS.forEach((item) => counts.set(item, accounts.get(item)?.length ?? 0));
    return counts;
  }, [accounts]);

  const selectedAccounts = accounts.get(selectedPlatform) ?? [];

  const healthBucket = useCallback(
    (account: Account): StatusFilter => {
      const state = snapshots.get(account.id)?.validation.state ?? normalizeAccountStatus(account.status);
      if (state === 'valid') return 'healthy';
      if (state === 'pending' || state === 'unsupported') return 'pending';
      return 'warning';
    },
    [snapshots],
  );

  const selectedStats = useMemo(() => {
    let warning = 0;
    for (const account of selectedAccounts) {
      if (healthBucket(account) === 'warning') warning += 1;
    }
    return {
      total: selectedAccounts.length,
      warning,
    };
  }, [healthBucket, selectedAccounts]);

  const tags = useMemo(() => {
    const set = new Set<string>();
    selectedAccounts.forEach((account) => account.tags.forEach((tag) => set.add(tag)));
    return Array.from(set).sort();
  }, [selectedAccounts]);

  const filteredAccounts = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    return selectedAccounts
      .filter((account) => {
        if (statusFilter !== 'all' && healthBucket(account) !== statusFilter) return false;
        if (tagFilter && !account.tags.includes(tagFilter)) return false;
        if (quotaFilter !== 'all' && quotaBucket(quotaStates.get(account.id)) !== quotaFilter) {
          return false;
        }
        if (!query) return true;
        return (
          account.email.toLowerCase().includes(query) ||
          account.identityKey.toLowerCase().includes(query) ||
          account.displayIdentifier.toLowerCase().includes(query) ||
          (account.name?.toLowerCase().includes(query) ?? false) ||
          account.tags.some((tag) => tag.toLowerCase().includes(query))
        );
      })
      .sort((a, b) => compareAccounts(a, b, sortMode, quotaStates));
  }, [healthBucket, quotaFilter, quotaStates, searchText, selectedAccounts, sortMode, statusFilter, tagFilter]);

  useEffect(() => {
    const ids = filteredAccounts.map((account) => account.id);
    if (ids.length === 0) return;
    ensureQuotaStates(ids).catch(() => {});
  }, [ensureQuotaStates, filteredAccounts]);

  const visiblePlatforms = useMemo(() => {
    const query = platformSearch.trim().toLowerCase();
    const filtered = query
      ? ALL_PLATFORMS.filter((item) =>
          getDisplayName(item).toLowerCase().includes(query) || item.toLowerCase().includes(query),
        )
      : ALL_PLATFORMS;
    return [...filtered].sort((a, b) => {
      const countDiff = (platformCounts.get(b) ?? 0) - (platformCounts.get(a) ?? 0);
      if (countDiff !== 0) return countDiff;
      return platformOrder(a) - platformOrder(b);
    });
  }, [getDisplayName, platformCounts, platformSearch]);

  const handleSwitch = useCallback(
    (accountPlatform: AgentId, accountId: string) => {
      if (switchingId) return;
      if (switchDebounceRef.current) clearTimeout(switchDebounceRef.current);
      setSwitchingId(accountId);
      switchDebounceRef.current = setTimeout(async () => {
        try {
          await switchAccount(accountPlatform, accountId);
          toast.success(t('switchSuccess'));
        } catch {
          toast.error(t('switchFailed'));
        } finally {
          setSwitchingId(null);
        }
      }, 300);
    },
    [switchAccount, switchingId, t],
  );

  const handleDelete = async (accountId: string) => {
    try {
      await deleteAccount(accountId);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(accountId);
        return next;
      });
    } catch {
      toast.error(t('switchFailed'));
    }
  };

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    try {
      await batchDelete(Array.from(selectedIds));
      setSelectedIds(new Set());
      setShowDeleteConfirm(false);
    } catch {
      toast.error(t('switchFailed'));
    }
  };

  const handleRefreshSelectedPlatform = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const ids = selectedAccounts.map((account) => account.id);
      await refreshBatch(ids).catch(() => {});
      const results = await Promise.allSettled(ids.map((id) => refreshQuotaState(id)));
      // 刷新结束后重新拉取该平台账号,使会员计划/有效期等账号字段同步更新
      await fetchAccounts(selectedPlatform);
      // 同时探测各 agent 真机当前登录的账号,回写「使用中」状态(尽力而为,失败不影响额度刷新结果)
      await detectActiveAccounts().catch(() => {});
      const failed = results.filter((result) => result.status === 'rejected').length;
      if (failed > 0) {
        toast.error(t('refreshFailed'), {
          description: t('refreshFailedCount', { failed, total: ids.length }),
        });
      }
    } finally {
      setRefreshing(false);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredAccounts.length && filteredAccounts.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredAccounts.map((account) => account.id)));
    }
  };

  return (
    <div
      data-testid="accounts-page-shell"
      className="flex h-[calc(100vh-96px)] w-full max-w-full min-w-0 overflow-hidden bg-card"
    >
      <aside className="flex h-full min-h-0 w-[180px] shrink-0 flex-col border-r border-border/80 px-3 py-4">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            strokeWidth={1.9}
          />
          <Input
            value={platformSearch}
            onChange={(event) => setPlatformSearch(event.target.value)}
            placeholder="搜索平台"
            className="h-8 rounded-[8px] bg-card pl-7 text-[12px]"
          />
        </div>
        <div className="mt-4 text-[12px] font-medium text-foreground/70">平台</div>
        <ScrollArea data-testid="accounts-platform-scroll" className="mt-2 min-h-0 flex-1 pr-1">
          <nav className="flex min-w-0 flex-col gap-1" aria-label="账号平台">
            {visiblePlatforms.map((item) => {
              const active = item === selectedPlatform;
              return (
                <button
                  key={item}
                  type="button"
                  onClick={() => setSelectedPlatform(item)}
                  className={cn(
                    'flex h-9 w-full min-w-0 items-center gap-2 rounded-[8px] px-2 text-left transition-colors',
                    active
                      ? 'bg-primary/10 text-primary'
                      : 'text-foreground/80 hover:bg-muted/60 hover:text-foreground',
                  )}
                >
                  <PlatformIcon platform={item} className="size-6 rounded-[6px]" />
                  <span className="min-w-0 flex-1 truncate text-[12px] font-medium">
                    {getDisplayName(item)}
                  </span>
                  <span className="shrink-0 text-[12px] font-semibold tabular-nums">
                    {platformCounts.get(item) ?? 0}
                  </span>
                </button>
              );
            })}
          </nav>
        </ScrollArea>
      </aside>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="shrink-0 border-b border-border/80 px-5 pb-3 pt-5">
          <div className="flex min-w-0 flex-wrap items-center gap-2.5 xl:flex-nowrap">
            <PlatformIcon platform={selectedPlatform} className="size-10 rounded-[9px]" />
            <div className="min-w-[180px] flex-1">
              <h2 className="text-[18px] font-semibold leading-6 text-foreground">
                {getDisplayName(selectedPlatform)} 账号
              </h2>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                {PLATFORM_DESCRIPTIONS[selectedPlatform]}
              </p>
            </div>
            <div data-testid="accounts-header-actions" className="flex shrink-0 items-center gap-1">
              <InfoPill icon={Users} tone="blue" label={`${selectedStats.total} 个账号`} />
              <InfoPill icon={Bell} tone="orange" label={`${selectedStats.warning} 个告警`} />
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      className="size-8 rounded-[8px] p-0"
                      aria-label={t('tooltips.add')}
                      onClick={() => setShowImportSheet(true)}
                    >
                      <Plus className="size-3.5" strokeWidth={2} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t('tooltips.add')}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HeaderIconButton
                      label={refreshing ? t('refreshing') : t('tooltips.refresh')}
                      icon={RefreshCw}
                      spin={refreshing}
                      onClick={handleRefreshSelectedPlatform}
                    />
                  </TooltipTrigger>
                  <TooltipContent>{refreshing ? t('refreshing') : t('tooltips.refresh')}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HeaderIconButton label={t('tooltips.export')} icon={Upload} onClick={() => {}} />
                  </TooltipTrigger>
                  <TooltipContent>{t('tooltips.export')}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HeaderIconButton
                      label={t('tooltips.settings')}
                      icon={Settings}
                      onClick={() => setShowPlatformSettings(true)}
                    />
                  </TooltipTrigger>
                  <TooltipContent>{t('tooltips.settings')}</TooltipContent>
                </Tooltip>
                <div
                  data-testid="accounts-view-toggle"
                  className="inline-flex h-8 shrink-0 overflow-hidden rounded-[8px] border border-input bg-card"
                >
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <ViewButton label={t('tooltips.viewTable')} active={view === 'table'} icon={Table2} onClick={() => setView('table')} />
                    </TooltipTrigger>
                    <TooltipContent>{t('tooltips.viewTable')}</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <ViewButton label={t('tooltips.viewCard')} active={view === 'card'} icon={LayoutGrid} onClick={() => setView('card')} />
                    </TooltipTrigger>
                    <TooltipContent>{t('tooltips.viewCard')}</TooltipContent>
                  </Tooltip>
                </div>
              </TooltipProvider>
            </div>
          </div>

          <div
            data-testid="accounts-toolbar-row"
            className="mt-3 flex min-w-0 flex-wrap items-center gap-1.5 2xl:flex-nowrap"
          >
            <ManagementSearchField
              testId="accounts-search"
              value={searchText}
              onChange={setSearchText}
              placeholder="搜索账号 / 邮箱 / 用户 ID"
            />

            <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as StatusFilter)}>
              <SelectTrigger data-testid="accounts-status-filter" className="h-8 w-[98px] rounded-[8px] text-[12px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">状态：全部</SelectItem>
                <SelectItem value="healthy">状态：正常</SelectItem>
                <SelectItem value="warning">状态：告警</SelectItem>
                <SelectItem value="pending">状态：待校验</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={tagFilter || FILTER_ALL_TAGS}
              onValueChange={(value) => setTagFilter(value === FILTER_ALL_TAGS ? '' : value)}
            >
              <SelectTrigger data-testid="accounts-tag-filter" className="h-8 w-[98px] rounded-[8px] text-[12px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={FILTER_ALL_TAGS}>标签：全部</SelectItem>
                {tags.map((tag) => (
                  <SelectItem key={tag} value={tag}>
                    {tag}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={quotaFilter} onValueChange={(value) => setQuotaFilter(value as QuotaFilter)}>
              <SelectTrigger data-testid="accounts-quota-filter" className="h-8 w-[98px] rounded-[8px] text-[12px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">额度：全部</SelectItem>
                <SelectItem value="ok">额度：正常</SelectItem>
                <SelectItem value="warning">额度：紧张</SelectItem>
                <SelectItem value="unknown">额度：未知</SelectItem>
              </SelectContent>
            </Select>

            <Select value={sortMode} onValueChange={(value) => setSortMode(value as SortMode)}>
              <SelectTrigger data-testid="accounts-sort-filter" className="h-8 w-[118px] rounded-[8px] text-[12px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="quota">排序：综合额度</SelectItem>
                <SelectItem value="recent">排序：同步时间</SelectItem>
                <SelectItem value="name">排序：账号名称</SelectItem>
              </SelectContent>
            </Select>

          </div>
        </div>

        <ScrollArea data-testid="accounts-data-scroll" className="min-h-0 min-w-0 flex-1">
          <div className="min-w-0 px-3 py-3">
            {loading && selectedAccounts.length === 0 ? (
              <div className="flex min-h-[320px] items-center justify-center rounded-[8px] border border-border">
                <div className="size-6 animate-spin rounded-full border-2 border-muted-foreground border-t-foreground" />
              </div>
            ) : filteredAccounts.length === 0 ? (
              <div
                data-testid="accounts-empty-state"
                className="flex min-h-[320px] flex-col items-center justify-center gap-3 rounded-[8px] border border-border bg-card"
              >
                <div
                  data-testid="accounts-empty-icon"
                  className="mx-auto flex size-10 shrink-0 items-center justify-center rounded-full bg-muted"
                >
                  <Users className="size-5 text-muted-foreground" strokeWidth={1.85} />
                </div>
                <div className="space-y-1 text-center">
                  <p className="text-sm font-medium text-foreground">
                    {selectedAccounts.length === 0 ? t('empty.title') : t('empty.noMatch')}
                  </p>
                  <p className="text-xs text-muted-foreground">{t('empty.subtitle')}</p>
                </div>
                {selectedAccounts.length === 0 ? (
                  <Button size="sm" onClick={() => setShowImportSheet(true)} className="gap-1.5">
                    <Plus className="size-3.5" strokeWidth={2.25} />
                    {t('import')}
                  </Button>
                ) : null}
              </div>
            ) : view === 'card' ? (
              <div className="accounts-card-region min-w-0">
                <div className="accounts-card-grid">
                  {filteredAccounts.map((account) => (
                    <AccountCard
                      key={account.id}
                      account={account}
                      platformDisplayName={getDisplayName(account.platform)}
                      selected={selectedIds.has(account.id)}
                      active={account.isActive}
                      highlighted={highlightedId === account.id}
                      switching={switchingId === account.id}
                      onToggleSelect={() => toggleSelect(account.id)}
                      onSwitch={() => handleSwitch(account.platform, account.id)}
                      onDelete={() => handleDelete(account.id)}
                      onOpen={() => setHighlightedId(account.id)}
                      onEdit={() => setEditTarget(account)}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <div>
                <AccountDataTable
                  accounts={filteredAccounts}
                  platformDisplayName={getDisplayName}
                  selectedIds={selectedIds}
                  highlightedId={highlightedId}
                  switchingId={switchingId}
                  onToggleSelectAll={toggleSelectAll}
                  onToggleSelect={toggleSelect}
                  onSwitch={handleSwitch}
                  onDelete={handleDelete}
                  onOpen={setHighlightedId}
                  onEdit={(id) => {
                    const acc = filteredAccounts.find((a) => a.id === id);
                    if (acc) setEditTarget(acc);
                  }}
                />
                {selectedIds.size > 0 ? (
                  <div className="mt-2 flex h-11 items-center justify-between rounded-[8px] border border-border bg-muted/20 px-4">
                    <span className="text-[12px] text-muted-foreground">
                      {t('actions.selected', { count: selectedIds.size })}
                    </span>
                    <Button
                      variant="destructive"
                      size="sm"
                      className="h-8"
                      onClick={() => setShowDeleteConfirm(true)}
                    >
                      {t('actions.batchDelete')}
                    </Button>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </ScrollArea>
      </section>

      <AddAccountSheet
        open={showImportSheet}
        onOpenChange={setShowImportSheet}
        defaultPlatform={selectedPlatform}
        onSuccess={() => {
          toast.success(t('importSuccess'));
          fetchAccounts(selectedPlatform);
        }}
      />

      <EditAccountDialog
        account={editTarget}
        open={editTarget !== null}
        onOpenChange={(open) => {
          if (!open) setEditTarget(null);
        }}
        onSaved={() => fetchAccounts(selectedPlatform)}
      />

      <PlatformSettingsDialog
        platform={selectedPlatform}
        open={showPlatformSettings}
        onOpenChange={setShowPlatformSettings}
      />

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('confirmDelete')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('confirmBatchDeleteMsg', { count: selectedIds.size })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleBatchDelete}
            >
              {t('actions.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

const ViewButton = forwardRef<
  HTMLButtonElement,
  {
    label: string;
    active: boolean;
    icon: LucideIcon;
    onClick: () => void;
  }
>(function ViewButton({ label, active, icon: Icon, onClick }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      aria-pressed={active}
      className={cn(
        'inline-flex size-8 items-center justify-center border-r border-border text-muted-foreground last:border-r-0 hover:bg-muted/50 hover:text-foreground',
        active && 'bg-primary/10 text-primary',
      )}
      onClick={onClick}
    >
      <Icon className="size-3.5" strokeWidth={2} />
    </button>
  );
});

function isAgentId(value: unknown): value is AgentId {
  return typeof value === 'string' && ALL_PLATFORMS.includes(value as AgentId);
}

function platformOrder(platform: AgentId) {
  return PLATFORM_SORT_INDEX.get(platform) ?? Number.MAX_SAFE_INTEGER;
}

function normalizeAccountStatus(status?: string): string {
  const normalized = status?.trim().toLowerCase();
  if (!normalized) return 'pending';
  if (['active', 'valid', 'ok', 'enabled'].includes(normalized)) return 'valid';
  if (['expired', 'disabled'].includes(normalized)) return 'expired';
  if (['revoked', 'failed', 'error'].includes(normalized)) return 'revoked';
  if (['limited', 'warning', 'rate_limited'].includes(normalized)) return 'rate_limited';
  return 'pending';
}

function quotaBucket(state: AccountQuotaState | undefined): QuotaFilter {
  if (!state) return 'unknown';
  if (state.status === 'ok') return 'ok';
  if (state.status === 'warning' || state.status === 'exhausted' || state.status === 'error') {
    return 'warning';
  }
  return 'unknown';
}

export function compareAccounts(
  a: Account,
  b: Account,
  sortMode: SortMode,
  quotaStates: Map<string, AccountQuotaState>,
) {
  // The account the agent is currently using always pins to the top, regardless
  // of sort mode, so "which account is active" is answerable at a glance.
  if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
  if (sortMode === 'name') return accountTitle(a).localeCompare(accountTitle(b));
  if (sortMode === 'recent') return dateValue(b.lastUsedAt) - dateValue(a.lastUsedAt);
  return quotaScore(quotaStates.get(b.id)) - quotaScore(quotaStates.get(a.id));
}

function accountTitle(account: Account) {
  return account.name || account.displayIdentifier || account.email;
}

function quotaScore(state?: AccountQuotaState) {
  if (!state) return -1;
  const metric = primaryMetric(state);
  return metric?.percentUsed ?? metric?.percentRemaining ?? 0;
}

function dateValue(iso?: string) {
  if (!iso) return 0;
  const value = new Date(iso).getTime();
  return Number.isNaN(value) ? 0 : value;
}
