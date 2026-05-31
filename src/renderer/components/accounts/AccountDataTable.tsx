import type { CSSProperties, ComponentType } from 'react';
import { useMemo } from 'react';
import {
  type Column,
  type ColumnDef,
  type ColumnPinningState,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import {
  ArrowLeftRight,
  Chrome,
  Copy,
  Github,
  KeyRound,
  Mail,
  MoreHorizontal,
  Pencil,
  RefreshCw,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { useAccountStore, useHealthStore, useQuotaStateStore } from '../../stores';
import type { Account } from '../../types';
import { accountPlanLabel, codexSubscriptionInfo, type CodexSubscriptionInfo } from './account-plan';
import { PlatformIcon } from './PlatformIcon';
import { metricLines, primaryMetric, type MetricTone } from './quota-display';

interface AccountDataTableProps {
  accounts: Account[];
  platformDisplayName: (platform: Account['platform']) => string;
  selectedIds: Set<string>;
  highlightedId: string | null;
  switchingId: string | null;
  onToggleSelectAll: () => void;
  onToggleSelect: (id: string) => void;
  onSwitch: (platform: Account['platform'], id: string) => void;
  onDelete: (id: string) => void;
  onOpen: (id: string) => void;
}

const PINNING: ColumnPinningState = {
  left: ['select', 'account'],
  right: ['actions'],
};

export function AccountDataTable({
  accounts,
  platformDisplayName,
  selectedIds,
  highlightedId,
  switchingId,
  onToggleSelectAll,
  onToggleSelect,
  onSwitch,
  onDelete,
  onOpen,
}: AccountDataTableProps) {
  const { t } = useTranslation('accounts');
  const allSelected = accounts.length > 0 && selectedIds.size === accounts.length;
  const partiallySelected = selectedIds.size > 0 && selectedIds.size < accounts.length;

  const columns = useMemo<ColumnDef<Account>[]>(
    () => [
      {
        id: 'select',
        size: 44,
        header: () => (
          <Checkbox
            checked={allSelected ? true : partiallySelected ? 'indeterminate' : false}
            onCheckedChange={onToggleSelectAll}
            aria-label={t('actions.selectAll')}
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={selectedIds.has(row.original.id)}
            onCheckedChange={() => onToggleSelect(row.original.id)}
            aria-label={t('actions.selectAll')}
          />
        ),
      },
      {
        id: 'account',
        size: 244,
        header: () => '账号 / 用户 ID',
        cell: ({ row }) => <AccountIdentity account={row.original} />,
      },
      {
        id: 'tags',
        size: 174,
        header: () => '平台标签 / 业务标签',
        cell: ({ row }) => (
          <AccountTags account={row.original} platformDisplayName={platformDisplayName(row.original.platform)} />
        ),
      },
      {
        id: 'plan',
        size: 124,
        header: () => '会员计划',
        cell: ({ row }) => <AccountPlanCell account={row.original} />,
      },
      {
        id: 'login',
        size: 108,
        header: () => '登录方式',
        cell: ({ row }) => {
          const login = row.original.loginProvider || loginFallback(row.original);
          return (
            <span className="flex min-w-0 items-center gap-1.5 text-[13px] text-foreground">
              {loginIcon(login)}
              <span className="truncate">{login}</span>
            </span>
          );
        },
      },
      {
        id: 'status',
        size: 76,
        header: () => '状态',
        cell: ({ row }) => <AccountStatus account={row.original} />,
      },
      {
        id: 'quota',
        size: 156,
        header: () => '额度 (Auto)',
        cell: ({ row }) => <AccountQuota account={row.original} />,
      },
      {
        id: 'sync',
        size: 86,
        header: () => '同步时间',
        cell: ({ row }) => (
          <span className="text-[13px] text-muted-foreground">
            {formatRelativeTime(row.original.lastUsedAt || row.original.createdAt)}
          </span>
        ),
      },
      {
        id: 'actions',
        size: 106,
        header: () => <span className="block text-right">操作</span>,
        cell: ({ row }) => (
          <RowActions
            account={row.original}
            active={row.original.isActive}
            switching={switchingId === row.original.id}
            onSwitch={() => onSwitch(row.original.platform, row.original.id)}
            onOpen={() => onOpen(row.original.id)}
            onDelete={() => onDelete(row.original.id)}
          />
        ),
      },
    ],
    [
      allSelected,
      onDelete,
      onOpen,
      onSwitch,
      onToggleSelect,
      onToggleSelectAll,
      partiallySelected,
      platformDisplayName,
      selectedIds,
      switchingId,
      t,
    ],
  );

  const table = useReactTable({
    data: accounts,
    columns,
    enableColumnPinning: true,
    getCoreRowModel: getCoreRowModel(),
    state: { columnPinning: PINNING },
  });

  return (
    <div data-testid="accounts-table" className="min-w-0 overflow-hidden rounded-[8px] border border-border bg-card">
      <Table className="min-w-[1040px] table-fixed">
        <TableHeader className="bg-muted/25">
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id} className="hover:bg-transparent">
              {headerGroup.headers.map((header) => (
                <TableHead
                  key={header.id}
                  className={cn(
                    'h-10 px-2.5 text-[11.5px] font-medium',
                    pinnedCellClass(header.column, true, false),
                  )}
                  style={columnStyle(header.column)}
                >
                  {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => {
            const highlighted = highlightedId === row.original.id;
            return (
              <TableRow
                key={row.id}
                data-state={selectedIds.has(row.original.id) ? 'selected' : undefined}
                className={cn(
                  'group h-[64px] hover:bg-muted',
                  highlighted && 'bg-primary/[0.03]',
                )}
                onDoubleClick={() => onOpen(row.original.id)}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell
                    key={cell.id}
                    className={cn(
                      'px-2.5 py-2.5',
                      pinnedCellClass(cell.column, false, highlighted),
                    )}
                    style={columnStyle(cell.column)}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function columnStyle(column: Column<Account, unknown>): CSSProperties {
  const pinned = column.getIsPinned();
  return {
    left: pinned === 'left' ? `${column.getStart('left')}px` : undefined,
    right: pinned === 'right' ? `${column.getAfter('right')}px` : undefined,
    width: `${column.getSize()}px`,
    minWidth: `${column.getSize()}px`,
    maxWidth: `${column.getSize()}px`,
  };
}

function pinnedCellClass(column: Column<Account, unknown>, header: boolean, highlighted: boolean) {
  const pinned = column.getIsPinned();
  if (!pinned) return '';
  return cn(
    header
      ? 'sticky z-30 bg-muted'
      : 'sticky z-20 bg-card group-hover:bg-muted group-data-[state=selected]:bg-muted',
    highlighted && !header && 'bg-card group-hover:bg-muted',
    column.id === 'account' && 'shadow-[1px_0_0_hsl(var(--border))]',
    column.id === 'actions' && 'z-40 shadow-[-1px_0_0_hsl(var(--border))]',
  );
}

function AccountIdentity({ account }: { account: Account }) {
  const title = account.name || account.displayIdentifier || account.email;
  const identity = account.identityKey || account.displayIdentifier || account.email;
  return (
    <div className="flex min-w-0 items-center gap-3">
      <PlatformIcon platform={account.platform} className="size-7 rounded-[7px]" />
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[12.5px] font-semibold text-foreground">{title}</span>
          <CopyButton value={identity} />
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11.5px] text-muted-foreground">
          <span className="truncate">{identity}</span>
        </div>
      </div>
    </div>
  );
}

function AccountTags({
  account,
  platformDisplayName,
}: {
  account: Account;
  platformDisplayName: string;
}) {
  return (
    <div className="flex min-w-0 flex-wrap gap-1.5">
      <Badge className="h-5 border-transparent bg-primary/10 px-1.5 text-[11.5px] text-primary hover:bg-primary/10">
        {platformDisplayName}
      </Badge>
      {account.tags.slice(0, 2).map((tag) => (
        <Badge
          key={tag}
          variant="outline"
          className="h-5 border-border bg-muted/50 px-1.5 text-[11.5px] text-foreground/75"
        >
          {tag}
        </Badge>
      ))}
    </div>
  );
}

function AccountPlanCell({ account }: { account: Account }) {
  const subscription = codexSubscriptionInfo(account);
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="truncate text-[13px] text-foreground/80">
        {accountPlanLabel(account)}
      </span>
      {subscription ? (
        <span className={cn('truncate text-[10.5px]', subscriptionToneClass(subscription.tone))}>
          {subscription.detailText ? `到期：${subscription.detailText}` : subscription.valueText}
        </span>
      ) : null}
    </div>
  );
}

function AccountStatus({ account }: { account: Account }) {
  const { t } = useTranslation('accounts');
  const snapshot = useHealthStore((s) => s.snapshots.get(account.id));
  if (account.platform === 'codex') {
    return (
      <span className="inline-flex items-center rounded-[6px] bg-primary/10 px-1.5 py-0.5 text-[12px] font-semibold text-primary">
        {accountPlanLabel(account)}
      </span>
    );
  }

  const state = snapshot?.validation.state ?? normalizeAccountStatus(account.status);
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-[12.5px] font-medium', statusColor(state))}>
      <span className={cn('size-1.5 rounded-full', statusDot(state))} aria-hidden />
      {account.isActive ? t('card.active') : t(`health.${state}`)}
    </span>
  );
}

function normalizeAccountStatus(status?: string): string {
  const normalized = status?.trim().toLowerCase();
  if (!normalized) return 'pending';
  if (['active', 'valid', 'ok', 'enabled', 'normal', 'healthy'].includes(normalized)) return 'valid';
  if (['expired', 'disabled', 'requires_reauth', 'reauth_required'].includes(normalized)) return 'expired';
  if (['revoked', 'failed', 'error', 'invalid'].includes(normalized)) return 'revoked';
  if (['limited', 'warning', 'rate_limited'].includes(normalized)) return 'rate_limited';
  return 'pending';
}

function AccountQuota({ account }: { account: Account }) {
  const quotaState = useQuotaStateStore((s) => s.states.get(account.id));
  const line = metricLines(account, quotaState)[0];
  const primary = primaryMetric(quotaState);
  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between gap-2">
        <span className={cn('truncate font-medium', quotaTextColor(line?.tone))}>
          {line?.label ?? '额度'}
          {line?.value ? ` ${line.value}` : primary?.displayValue ? ` ${primary.displayValue}` : ''}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full', quotaProgressColor(line?.tone))}
          style={{ width: `${Math.max(0, Math.min(100, line?.progress ?? 0))}%` }}
        />
      </div>
      {line?.subValue ? (
        <div className="mt-1 truncate text-[10.5px] text-muted-foreground">
          {line.subValue}
        </div>
      ) : null}
    </div>
  );
}

function RowActions({
  account,
  active,
  switching,
  onSwitch,
  onOpen,
  onDelete,
}: {
  account: Account;
  active?: boolean;
  switching?: boolean;
  onSwitch: () => void;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation('accounts');
  const refreshing = useHealthStore((s) => s.refreshing.has(account.id));
  const quotaRefreshing = useQuotaStateStore((s) => s.loading.has(account.id));
  const refreshQuotaState = useQuotaStateStore((s) => s.refresh);
  const fetchAccounts = useAccountStore((s) => s.fetchAccounts);
  const handleRefresh = () => {
    refreshQuotaState(account.id)
      .then(() => {
        // 刷新成功后重新拉取该平台账号,使会员计划/有效期等账号派生字段同步更新
        void fetchAccounts(account.platform);
      })
      .catch((error: unknown) => {
        toast.error(t('refreshFailed'), {
          description: error instanceof Error ? error.message : String(error),
        });
      });
  };
  return (
    <div className="flex items-center justify-end gap-1">
      <IconAction
        label={switching ? t('actions.switching') : t('actions.switch')}
        disabled={active || !!switching}
        icon={ArrowLeftRight}
        onClick={onSwitch}
      />
      <IconAction
        label={t('actions.refresh')}
        disabled={refreshing || quotaRefreshing}
        icon={RefreshCw}
        spin={refreshing || quotaRefreshing}
        onClick={handleRefresh}
      />
      <IconAction label={t('actions.viewDetail')} icon={Pencil} onClick={onOpen} />
      <IconAction label={t('actions.delete')} icon={MoreHorizontal} onClick={onDelete} />
    </div>
  );
}

function CopyButton({ value }: { value: string }) {
  return (
    <button
      type="button"
      aria-label="复制账号标识"
      className="inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
      onClick={(event) => {
        event.stopPropagation();
        navigator.clipboard?.writeText(value).catch(() => {});
      }}
    >
      <Copy className="size-3.5" strokeWidth={1.8} />
    </button>
  );
}

function IconAction({
  label,
  icon: Icon,
  disabled,
  spin,
  onClick,
}: {
  label: string;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  disabled?: boolean;
  spin?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      disabled={disabled}
      className="size-7 rounded-[6px] text-foreground/75 hover:bg-muted hover:text-foreground"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      <Icon className={cn('size-3.5', spin && 'animate-spin')} strokeWidth={1.9} />
    </Button>
  );
}

function statusColor(state: string) {
  if (state === 'valid') return 'text-emerald-600';
  if (state === 'expired' || state === 'revoked') return 'text-rose-600';
  if (state === 'rate_limited') return 'text-orange-600';
  return 'text-muted-foreground';
}

function statusDot(state: string) {
  if (state === 'valid') return 'bg-emerald-500';
  if (state === 'expired' || state === 'revoked') return 'bg-rose-500';
  if (state === 'rate_limited') return 'bg-orange-500';
  return 'bg-zinc-400';
}

function subscriptionToneClass(tone: CodexSubscriptionInfo['tone']) {
  if (tone === 'expired') return 'text-rose-600 dark:text-rose-400';
  if (tone === 'warning') return 'text-orange-600 dark:text-orange-400';
  return 'text-muted-foreground';
}

function loginFallback(account: Account): string {
  if (account.platform === 'github-copilot') return 'GitHub 登录';
  if (account.platform === 'cursor' || account.platform === 'gemini-cli') return 'Google 登录';
  if (account.platform === 'codex' || account.identityKey.toLowerCase().includes('api')) return 'API Key';
  return '设备登录';
}

function loginIcon(login: string) {
  const normalized = login.toLowerCase();
  if (normalized.includes('github')) return <Github className="size-3.5" strokeWidth={2} />;
  if (normalized.includes('google')) {
    return <Chrome className="size-3.5 text-[#4285f4]" strokeWidth={2} />;
  }
  if (normalized.includes('api') || normalized.includes('token')) {
    return <KeyRound className="size-3.5" strokeWidth={2} />;
  }
  return <Mail className="size-3.5" strokeWidth={2} />;
}

function quotaTextColor(tone: MetricTone = 'normal') {
  switch (tone) {
    case 'warning':
      return 'text-orange-600';
    case 'danger':
      return 'text-rose-600';
    case 'muted':
      return 'text-muted-foreground';
    case 'success':
    case 'normal':
    default:
      return 'text-foreground';
  }
}

function quotaProgressColor(tone: MetricTone = 'normal') {
  switch (tone) {
    case 'warning':
      return 'bg-orange-500';
    case 'danger':
      return 'bg-rose-500';
    case 'muted':
      return 'bg-muted-foreground/25';
    case 'success':
      return 'bg-emerald-500';
    case 'normal':
    default:
      return 'bg-primary';
  }
}

function formatRelativeTime(iso?: string) {
  if (!iso) return '从未同步';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '从未同步';
  const minutes = Math.max(1, Math.round((Date.now() - then) / 60_000));
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.round(hours / 24)} 天前`;
}
