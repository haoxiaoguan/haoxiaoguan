import type { ComponentType } from 'react'
import { useMemo } from 'react'
import { type ColumnDef, type ColumnPinningState } from '@tanstack/react-table'
import {
  ArrowLeftRight,
  Chrome,
  Copy,
  Github,
  KeyRound,
  Mail,
  Pencil,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { DataTable } from '@/components/ui/data-table'
import { cn } from '@/lib/utils'
import { useAccountStore, useHealthStore, useQuotaStateStore } from '../../stores'
import type { Account } from '../../types'
import {
  accountPlanLabel,
  codexSubscriptionInfo,
  loginMethodLabel,
  type CodexSubscriptionInfo,
} from './account-plan'
import { PlatformIcon } from './PlatformIcon'
import { metricLines, primaryMetric, type MetricTone } from './quota-display'
import { maskEmailText } from './identity-mask'

interface AccountDataTableProps {
  accounts: Account[]
  platformDisplayName: (platform: Account['platform']) => string
  selectedIds: Set<string>
  highlightedId: string | null
  switchingId: string | null
  onToggleSelectAll: () => void
  onToggleSelect: (id: string) => void
  onSwitch: (platform: Account['platform'], id: string) => void
  onDelete: (id: string) => void
  onOpen: (id: string) => void
  onEdit?: (id: string) => void
  /** 导出单个账号（cpa 格式）。 */
  onExport?: (id: string) => void
  /** 隐私模式：打码邮箱（截图/录屏场景）。 */
  hideEmail?: boolean
  /** 当前平台是否可入反代池（true 时显示「入池」列）。 */
  poolable?: boolean
  /** 已入池账号 id 集合。 */
  pooledIds?: Set<string>
  /** 切换账号入池。 */
  onTogglePooled?: (id: string, pooled: boolean) => void
  /** 页面纵向滚动容器（ScrollArea viewport），用于行虚拟化。 */
  scrollRef?: React.RefObject<HTMLElement | null>
}

const PINNING: ColumnPinningState = {
  left: ['select', 'account'],
  right: ['actions'],
}

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
  onEdit,
  onExport,
  hideEmail,
  poolable,
  pooledIds,
  onTogglePooled,
  scrollRef,
}: AccountDataTableProps) {
  const { t } = useTranslation('accounts')
  const allSelected = accounts.length > 0 && selectedIds.size === accounts.length
  const partiallySelected = selectedIds.size > 0 && selectedIds.size < accounts.length

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
        cell: ({ row }) => <AccountIdentity account={row.original} hideEmail={hideEmail} />,
      },
      {
        id: 'tags',
        size: 174,
        header: () => '平台标签 / 业务标签',
        cell: ({ row }) => (
          <AccountTags
            account={row.original}
            platformDisplayName={platformDisplayName(row.original.platform)}
          />
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
          const login = loginMethodLabel(row.original)
          return (
            <span className="flex min-w-0 items-center gap-1.5 text-[13px] text-foreground">
              {loginIcon(login)}
              <span className="truncate">{login}</span>
            </span>
          )
        },
      },
      {
        id: 'status',
        size: 76,
        header: () => '状态',
        cell: ({ row }) => <AccountStatus account={row.original} />,
      },
      ...(poolable && onTogglePooled
        ? [
            {
              id: 'pool',
              size: 72,
              header: () => t('card.pool'),
              cell: ({ row }) => (
                <Switch
                  checked={pooledIds?.has(row.original.id) ?? false}
                  onCheckedChange={(v) => onTogglePooled(row.original.id, v)}
                  aria-label={t('card.pool')}
                />
              ),
            } satisfies ColumnDef<Account>,
          ]
        : []),
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
        cell: ({ row }) => <AccountSyncTime account={row.original} />,
      },
      {
        id: 'actions',
        size: 130,
        header: () => <span className="block text-right">操作</span>,
        cell: ({ row }) => (
          <RowActions
            account={row.original}
            active={row.original.isActive}
            switching={switchingId === row.original.id}
            onSwitch={() => onSwitch(row.original.platform, row.original.id)}
            onOpen={() => onOpen(row.original.id)}
            onEdit={onEdit ? () => onEdit(row.original.id) : undefined}
            onExport={onExport ? () => onExport(row.original.id) : undefined}
            onDelete={() => onDelete(row.original.id)}
          />
        ),
      },
    ],
    [
      allSelected,
      hideEmail,
      onDelete,
      onEdit,
      onExport,
      onOpen,
      onSwitch,
      onToggleSelect,
      onToggleSelectAll,
      partiallySelected,
      platformDisplayName,
      selectedIds,
      switchingId,
      poolable,
      pooledIds,
      onTogglePooled,
      t,
    ],
  )

  return (
    <DataTable
      testId="accounts-table"
      columns={columns}
      data={accounts}
      getRowId={(account) => account.id}
      columnPinning={PINNING}
      scrollRef={scrollRef}
      estimateRowHeight={64}
      tableClassName="min-w-[1040px] table-fixed"
      headCellClassName="h-10 px-2.5 text-[11.5px] font-medium"
      cellClassName="px-2.5 py-2.5"
      rowProps={(row) => ({
        selected: selectedIds.has(row.original.id),
        onDoubleClick: () => onOpen(row.original.id),
        className: 'h-[64px]',
        // Idle row tint — emerald for the active account, primary for the
        // highlighted row. DataTable forwards this to every cell (pinned and
        // not) via --dt-row-tint, so fixed columns track the same shade.
        tint: row.original.isActive
          ? 'hsl(142 71% 45% / 0.04)'
          : highlightedId === row.original.id
            ? 'hsl(217 91% 60% / 0.03)'
            : undefined,
      })}
    />
  )
}

function AccountIdentity({ account, hideEmail }: { account: Account; hideEmail?: boolean }) {
  const { t } = useTranslation('accounts')
  const mask = (v: string) => (hideEmail ? maskEmailText(v) : v)
  // Primary line = email (the human-readable identifier); secondary = the stable
  // account id (userId / identityKey). Both are shown so enterprise accounts,
  // whose email and opaque userId differ, are unambiguous.
  const primary = mask(
    account.email || account.name || account.displayIdentifier || account.identityKey,
  )
  const secondary = mask(account.displayIdentifier || account.identityKey || account.email)
  return (
    <div className="flex min-w-0 items-center gap-3">
      <PlatformIcon platform={account.platform} className="size-7 rounded-[7px]" />
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[12.5px] font-semibold text-foreground">{primary}</span>
          {account.isActive ? (
            <span className="inline-flex h-[17px] shrink-0 items-center gap-1 rounded-[5px] bg-emerald-500/12 px-1.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
              <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden />
              {t('card.active')}
            </span>
          ) : null}
          <CopyButton value={secondary} />
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11.5px] text-muted-foreground">
          <span className="truncate">{secondary}</span>
        </div>
      </div>
    </div>
  )
}

function AccountTags({
  account,
  platformDisplayName,
}: {
  account: Account
  platformDisplayName: string
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
  )
}

function AccountPlanCell({ account }: { account: Account }) {
  const subscription = codexSubscriptionInfo(account)
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="truncate text-[13px] text-foreground/80">{accountPlanLabel(account)}</span>
      {subscription ? (
        <span className={cn('truncate text-[10.5px]', subscriptionToneClass(subscription.tone))}>
          {subscription.detailText ? `到期：${subscription.detailText}` : subscription.valueText}
        </span>
      ) : null}
    </div>
  )
}

function AccountStatus({ account }: { account: Account }) {
  const { t } = useTranslation('accounts')
  const snapshot = useHealthStore((s) => s.snapshots.get(account.id))
  const quotaState = useQuotaStateStore((s) => s.states.get(account.id))
  const quotaError = useQuotaStateStore((s) => s.errors.get(account.id))
  const baseState = snapshot?.validation.state ?? normalizeAccountStatus(account.status)
  // 与卡片视图一致：额度刷新失败时显示「刷新失败」而非「正常」（不覆盖更严重的失效态）。
  const refreshFailed = Boolean(quotaError) || quotaState?.status === 'error'
  const state =
    refreshFailed && !SEVERE_HEALTH_STATES.has(baseState) ? 'refresh_error' : baseState
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-[12.5px] font-medium',
        statusColor(state),
      )}
    >
      <span className={cn('size-1.5 rounded-full', statusDot(state))} aria-hidden />
      {t(`health.${state}`)}
    </span>
  )
}

function normalizeAccountStatus(status?: string): string {
  const normalized = status?.trim().toLowerCase()
  if (!normalized) return 'pending'
  if (['active', 'valid', 'ok', 'enabled', 'normal', 'healthy'].includes(normalized)) return 'valid'
  if (['expired', 'disabled', 'requires_reauth', 'reauth_required'].includes(normalized))
    return 'expired'
  if (['revoked', 'failed', 'error', 'invalid'].includes(normalized)) return 'revoked'
  if (['limited', 'warning', 'rate_limited'].includes(normalized)) return 'rate_limited'
  return 'pending'
}

function AccountQuota({ account }: { account: Account }) {
  const quotaState = useQuotaStateStore((s) => s.states.get(account.id))
  const line = metricLines(account, quotaState)[0]
  const primary = primaryMetric(quotaState)
  const topRight = line?.percentText ?? line?.value ?? primary?.displayValue
  const bottomText = line?.usageText
    ? line.resetText
      ? `${line.usageText} · ${line.resetText} 重置`
      : line.usageText
    : line?.subValue
  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between gap-2">
        <span className={cn('truncate font-medium', quotaTextColor(line?.tone))}>
          {line?.label ?? '额度'}
        </span>
        {topRight ? (
          <span className={cn('shrink-0 tabular-nums', quotaTextColor(line?.tone))}>
            {topRight}
          </span>
        ) : null}
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full', quotaProgressColor(line?.tone))}
          style={{ width: `${Math.max(0, Math.min(100, line?.progress ?? 0))}%` }}
        />
      </div>
      {bottomText ? (
        <div className="mt-1 truncate text-[10.5px] text-muted-foreground tabular-nums">
          {bottomText}
        </div>
      ) : null}
    </div>
  )
}

function AccountSyncTime({ account }: { account: Account }) {
  const fetchedAt = useQuotaStateStore((s) => s.states.get(account.id)?.fetchedAt)
  return (
    <span className="text-[13px] text-muted-foreground">
      {formatRelativeTime(fetchedAt || account.lastUsedAt || account.createdAt)}
    </span>
  )
}

function RowActions({
  account,
  active,
  switching,
  onSwitch,
  onOpen,
  onEdit,
  onExport,
  onDelete,
}: {
  account: Account
  active?: boolean
  switching?: boolean
  onSwitch: () => void
  onOpen: () => void
  onEdit?: () => void
  onExport?: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation('accounts')
  const refreshing = useHealthStore((s) => s.refreshing.has(account.id))
  const quotaRefreshing = useQuotaStateStore((s) => s.loading.has(account.id))
  const refreshQuotaState = useQuotaStateStore((s) => s.refresh)
  const fetchAccounts = useAccountStore((s) => s.fetchAccounts)
  const handleRefresh = () => {
    refreshQuotaState(account.id)
      .then(() => {
        // 刷新成功后重新拉取该平台账号,使会员计划/有效期等账号派生字段同步更新
        void fetchAccounts(account.platform)
      })
      .catch((error: unknown) => {
        toast.error(t('refreshFailed'), {
          description: error instanceof Error ? error.message : String(error),
        })
      })
  }
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
      <IconAction label={t('actions.viewDetail')} icon={Pencil} onClick={onEdit ?? onOpen} />
      {onExport && <IconAction label={t('actions.export')} icon={Upload} onClick={onExport} />}
      <IconAction label={t('actions.delete')} icon={Trash2} onClick={onDelete} />
    </div>
  )
}

function CopyButton({ value }: { value: string }) {
  return (
    <button
      type="button"
      aria-label="复制账号标识"
      className="inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
      onClick={(event) => {
        event.stopPropagation()
        navigator.clipboard?.writeText(value).catch(() => {})
      }}
    >
      <Copy className="size-3.5" strokeWidth={1.8} />
    </button>
  )
}

function IconAction({
  label,
  icon: Icon,
  disabled,
  spin,
  onClick,
}: {
  label: string
  icon: ComponentType<{ className?: string; strokeWidth?: number }>
  disabled?: boolean
  spin?: boolean
  onClick: () => void
}) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      disabled={disabled}
      className="size-7 rounded-[6px] text-foreground/75 hover:bg-muted hover:text-foreground"
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
    >
      <Icon className={cn('size-3.5', spin && 'animate-spin')} strokeWidth={1.9} />
    </Button>
  )
}

// 比「刷新失败」更严重的健康态：已是这些态时不被刷新失败覆盖（与 AccountCard 一致）。
const SEVERE_HEALTH_STATES = new Set(['expired', 'revoked', 'rate_limited'])

function statusColor(state: string) {
  if (state === 'valid') return 'text-emerald-600'
  if (state === 'expired' || state === 'revoked') return 'text-rose-600'
  if (state === 'rate_limited') return 'text-orange-600'
  if (state === 'refresh_error') return 'text-amber-600'
  return 'text-muted-foreground'
}

function statusDot(state: string) {
  if (state === 'valid') return 'bg-emerald-500'
  if (state === 'expired' || state === 'revoked') return 'bg-rose-500'
  if (state === 'rate_limited') return 'bg-orange-500'
  if (state === 'refresh_error') return 'bg-amber-500'
  return 'bg-zinc-400'
}

function subscriptionToneClass(tone: CodexSubscriptionInfo['tone']) {
  if (tone === 'expired') return 'text-rose-600 dark:text-rose-400'
  if (tone === 'warning') return 'text-orange-600 dark:text-orange-400'
  return 'text-muted-foreground'
}

function loginIcon(login: string) {
  const normalized = login.toLowerCase()
  if (normalized.includes('github')) return <Github className="size-3.5" strokeWidth={2} />
  if (normalized.includes('google')) {
    return <Chrome className="size-3.5 text-[#4285f4]" strokeWidth={2} />
  }
  if (normalized.includes('api') || normalized.includes('token')) {
    return <KeyRound className="size-3.5" strokeWidth={2} />
  }
  return <Mail className="size-3.5" strokeWidth={2} />
}

function quotaTextColor(tone: MetricTone = 'normal') {
  switch (tone) {
    case 'warning':
      return 'text-orange-600'
    case 'danger':
      return 'text-rose-600'
    case 'muted':
      return 'text-muted-foreground'
    case 'success':
    case 'normal':
    default:
      return 'text-foreground'
  }
}

function quotaProgressColor(tone: MetricTone = 'normal') {
  switch (tone) {
    case 'warning':
      return 'bg-orange-500'
    case 'danger':
      return 'bg-rose-500'
    case 'muted':
      return 'bg-muted-foreground/25'
    case 'success':
      return 'bg-emerald-500'
    case 'normal':
    default:
      return 'bg-primary'
  }
}

function formatRelativeTime(iso?: string) {
  if (!iso) return '从未同步'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return '从未同步'
  const minutes = Math.max(1, Math.round((Date.now() - then) / 60_000))
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.round(hours / 24)} 天前`
}
