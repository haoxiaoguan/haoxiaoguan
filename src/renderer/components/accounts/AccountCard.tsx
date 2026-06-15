import type { ComponentType, ReactNode } from 'react'
import {
  ArrowLeftRight,
  CalendarDays,
  Chrome,
  Copy,
  Github,
  KeyRound,
  Mail,
  Monitor,
  Pencil,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
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
import { metricLines, type MetricLine, type MetricTone } from './quota-display'
import { maskEmailText } from './identity-mask'

interface AccountCardProps {
  account: Account
  platformDisplayName: string
  selected: boolean
  active?: boolean
  highlighted?: boolean
  switching?: boolean
  onToggleSelect: () => void
  onSwitch: () => void
  onDelete: () => void
  onOpen: () => void
  onEdit?: () => void
  /** 导出单个账号（cpa 格式）。 */
  onExport?: () => void
  /** 隐私模式：打码邮箱（截图/录屏场景）。 */
  hideEmail?: boolean
  /** 反代池开关（仅可入池平台账号传入；不传则不渲染）。 */
  pool?: { pooled: boolean; onToggle: (pooled: boolean) => void }
}

const HEALTH_TONE: Record<string, { labelKey: string; className: string; dot: string }> = {
  valid: {
    labelKey: 'health.valid',
    className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    dot: 'bg-emerald-500',
  },
  expired: {
    labelKey: 'health.expired',
    className: 'bg-rose-500/10 text-rose-600 dark:text-rose-300',
    dot: 'bg-rose-500',
  },
  revoked: {
    labelKey: 'health.revoked',
    className: 'bg-rose-500/10 text-rose-600 dark:text-rose-300',
    dot: 'bg-rose-500',
  },
  rate_limited: {
    labelKey: 'health.rate_limited',
    className: 'bg-orange-500/10 text-orange-600 dark:text-orange-300',
    dot: 'bg-orange-500',
  },
  pending: {
    labelKey: 'health.pending',
    className: 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-300',
    dot: 'bg-zinc-400',
  },
}

export default function AccountCard(props: AccountCardProps) {
  const { t } = useTranslation('accounts')
  const snapshot = useHealthStore((s) => s.snapshots.get(props.account.id))
  const refreshing = useHealthStore((s) => s.refreshing.has(props.account.id))
  const quotaState = useQuotaStateStore((s) => s.states.get(props.account.id))
  const refreshQuotaState = useQuotaStateStore((s) => s.refresh)
  const quotaRefreshing = useQuotaStateStore((s) => s.loading.has(props.account.id))
  const quotaError = useQuotaStateStore((s) => s.errors.get(props.account.id))
  const fetchAccounts = useAccountStore((s) => s.fetchAccounts)

  const handleRefresh = () => {
    refreshQuotaState(props.account.id)
      .then(() => {
        // 刷新成功后重新拉取该平台账号,使会员计划/有效期/同步时间等账号派生字段同步更新
        void fetchAccounts(props.account.platform)
      })
      .catch((error: unknown) => {
        toast.error(t('refreshFailed'), {
          description: error instanceof Error ? error.message : String(error),
        })
      })
  }

  const state = snapshot?.validation.state ?? normalizeAccountStatus(props.account.status)
  const health = HEALTH_TONE[state] ?? {
    labelKey: `health.${state}`,
    className: 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-300',
    dot: 'bg-zinc-400',
  }
  const mask = (v: string) => (props.hideEmail ? maskEmailText(v) : v)
  const title = mask(props.account.name || props.account.displayIdentifier || props.account.email)
  const identity = mask(
    props.account.identityKey || props.account.displayIdentifier || props.account.email,
  )
  const plan = accountPlanLabel(props.account)
  const login = loginMethodLabel(props.account)
  // 不截断:cursor 有 Total/Auto/API/按需 四条,codex 两条,全部展示。
  const lines = metricLines(props.account, quotaState)
  const subscription = codexSubscriptionInfo(props.account)

  return (
    <article
      role="button"
      tabIndex={0}
      aria-pressed={props.selected}
      onClick={props.onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          props.onOpen()
        }
      }}
      className={cn(
        'group relative flex min-h-[224px] cursor-pointer flex-col rounded-[8px] border border-border bg-card px-3.5 py-3.5 text-card-foreground shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition-colors',
        'hover:border-primary/30 hover:bg-primary/[0.015]',
        props.highlighted && 'border-primary/50 ring-1 ring-primary/20',
        props.selected && 'border-primary/60',
        props.active && 'border-l-[3px] border-l-emerald-500 pl-[calc(0.875rem-2px)]',
      )}
    >
      <div className="flex items-start gap-3">
        <PlatformIcon platform={props.account.platform} className="size-9 rounded-[8px]" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <h3 className="truncate text-[13.5px] font-semibold leading-5 text-foreground">
              {title}
            </h3>
            {props.active ? <InUseChip label={t('card.active')} /> : null}
            <CopyButton value={identity} label="复制账号标识" />
          </div>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11.5px] text-muted-foreground">
            <span className="truncate">{identity}</span>
          </div>
        </div>
        <span
          className={cn(
            'inline-flex h-5 shrink-0 items-center gap-1 rounded-[6px] px-1.5 text-[11.5px] font-medium',
            health.className,
          )}
        >
          <span className={cn('size-1.5 rounded-full', health.dot)} aria-hidden />
          {t(health.labelKey)}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <Badge className="h-5 border-transparent bg-primary/10 px-1.5 text-[11.5px] text-primary hover:bg-primary/10">
          {props.platformDisplayName}
        </Badge>
        {props.account.tags.slice(0, 2).map((tag) => (
          <Badge
            key={tag}
            variant="outline"
            className="h-5 border-border bg-muted/50 px-1.5 text-[11.5px] text-foreground/75"
          >
            {tag}
          </Badge>
        ))}
      </div>

      {props.pool ? (
        <div
          className="mt-3 flex items-center justify-between rounded-[7px] bg-muted/40 px-2.5 py-1.5"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="min-w-0">
            <div className="text-[11.5px] font-medium text-foreground">{t('card.pool')}</div>
            <div className="text-[10.5px] text-muted-foreground">{t('card.poolHint')}</div>
          </div>
          <Switch
            checked={props.pool.pooled}
            onCheckedChange={props.pool.onToggle}
            aria-label={t('card.pool')}
          />
        </div>
      ) : null}

      <div className="mt-3 grid grid-cols-2 border-y border-border/70 py-2.5">
        <InfoCell label="会员计划" value={plan} />
        <InfoCell label="登录方式" value={login} icon={loginIcon(login)} />
      </div>

      <div className="mt-2.5 flex flex-1 flex-col gap-2.5">
        {lines.map((line) => (
          <QuotaLine key={`${line.label}-${line.value ?? ''}`} line={line} />
        ))}
      </div>

      {subscription ? <SubscriptionLine info={subscription} /> : null}

      <div className="mt-3 flex items-center justify-between border-t border-border/70 pt-2.5">
        {quotaError ? (
          <span
            className="inline-flex items-center gap-1 truncate text-[11.5px] font-medium text-rose-600 dark:text-rose-400"
            title={quotaError}
          >
            <span className="size-1.5 shrink-0 rounded-full bg-rose-500" aria-hidden />
            {t('refreshFailed')}
          </span>
        ) : (
          <span className="text-[11.5px] text-muted-foreground">
            {formatRelativeTime(
              quotaState?.fetchedAt || props.account.lastUsedAt || props.account.createdAt,
            )}
          </span>
        )}
        <div className="flex items-center gap-2">
          <IconAction
            label={props.switching ? t('actions.switching') : t('actions.switch')}
            disabled={props.active || !!props.switching}
            icon={ArrowLeftRight}
            onClick={props.onSwitch}
          />
          <IconAction
            label={t('actions.refresh')}
            disabled={refreshing || quotaRefreshing}
            icon={RefreshCw}
            spin={refreshing || quotaRefreshing}
            onClick={handleRefresh}
          />
          <IconAction
            label={t('actions.viewDetail')}
            icon={Pencil}
            onClick={props.onEdit ?? props.onOpen}
          />
          {props.onExport && (
            <IconAction label={t('actions.export')} icon={Upload} onClick={props.onExport} />
          )}
          <IconAction label={t('actions.delete')} icon={Trash2} onClick={props.onDelete} />
        </div>
      </div>
    </article>
  )
}

function SubscriptionLine({ info }: { info: CodexSubscriptionInfo }) {
  return (
    <div className="mt-2.5 flex min-w-0 items-center justify-between gap-2 rounded-[7px] bg-muted/45 px-2 py-1.5 text-[11.5px]">
      <span className="shrink-0 text-muted-foreground">会员有效期</span>
      <span className={cn('min-w-0 truncate font-medium', subscriptionToneClass(info.tone))}>
        {info.valueText}
        {info.detailText ? ` · ${info.detailText}` : ''}
      </span>
    </div>
  )
}

function InUseChip({ label }: { label: string }) {
  return (
    <span className="inline-flex h-[18px] shrink-0 items-center gap-1 rounded-[5px] bg-emerald-500/12 px-1.5 text-[10.5px] font-semibold text-emerald-700 dark:text-emerald-300">
      <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden />
      {label}
    </span>
  )
}

function CopyButton({ value, label }: { value: string; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
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

function InfoCell({ label, value, icon }: { label: string; value: string; icon?: ReactNode }) {
  return (
    <div className="min-w-0 border-r border-border/70 pr-3 last:border-r-0 last:pl-3 last:pr-0">
      <div className="text-[10.5px] font-medium text-muted-foreground">{label}</div>
      <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11.5px] font-medium text-foreground">
        {icon}
        <span className="truncate">{value}</span>
      </div>
    </div>
  )
}

function QuotaLine({ line }: { line: MetricLine }) {
  const progress = line.progress ?? 0
  // Top-right: prefer the explicit percent text; fall back to the line value
  // (e.g. Codex "85% 剩余" or a raw value) so non-credit metrics still show.
  const topRight = line.percentText ?? line.value
  // Bottom-left: used/total (e.g. "288 / 10,000"). Falls back to subLabel.
  const bottomLeft = line.usageText ?? line.subLabel
  // Bottom-right: reset date with a calendar icon.
  const resetText = line.resetText
  const hasBottom = !!bottomLeft || !!resetText

  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between gap-3 text-[11.5px]">
        <span className={cn('truncate font-medium', quotaTextColor(line.tone))}>{line.label}</span>
        {topRight ? (
          <span className={cn('shrink-0 font-semibold tabular-nums', quotaTextColor(line.tone))}>
            {topRight}
          </span>
        ) : null}
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full', quotaProgressColor(line.tone))}
          style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
        />
      </div>
      {hasBottom ? (
        <div className="mt-1.5 flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
          <span className="min-w-0 truncate tabular-nums">{bottomLeft ?? ''}</span>
          {resetText ? (
            // resetText 已含「剩余时长 (MM/DD HH:mm)」或「已重置」,不再追加后缀
            <span className="inline-flex shrink-0 items-center gap-1 tabular-nums">
              <CalendarDays className="size-3" strokeWidth={1.8} aria-hidden />
              {resetText}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
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
      className="size-6 rounded-[6px] text-foreground/75 hover:bg-muted hover:text-foreground"
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
    >
      <Icon className={cn('size-3.5', spin && 'animate-spin')} strokeWidth={1.9} />
    </Button>
  )
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
  if (normalized.includes('mail') || normalized.includes('邮箱')) {
    return <Mail className="size-3.5" strokeWidth={2} />
  }
  return <Monitor className="size-3.5" strokeWidth={2} />
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

function subscriptionToneClass(tone: CodexSubscriptionInfo['tone']) {
  if (tone === 'expired') return 'text-rose-600 dark:text-rose-400'
  if (tone === 'warning') return 'text-orange-600 dark:text-orange-400'
  if (tone === 'missing') return 'text-muted-foreground'
  return 'text-foreground'
}

function formatRelativeTime(iso?: string) {
  if (!iso) return '从未同步'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return '从未同步'
  const minutes = Math.max(1, Math.round((Date.now() - then) / 60_000))
  if (minutes < 60) return `${minutes} 分钟前同步`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} 小时前同步`
  return `${Math.round(hours / 24)} 天前同步`
}
