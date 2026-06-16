import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Activity,
  Eye,
  EyeOff,
  LayoutGrid,
  Minus,
  Plus,
  RefreshCw,
  Settings2,
  Timer,
  Table2,
  Trash2,
  TriangleAlert,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { useApiProxyStore } from '../stores/apiProxyStore'
import { useAccountStore, useQuotaStateStore } from '../stores'
import type { AccountPoolHealthRow, ApiProxySelectionConfigDto } from '@shared/api-types'
import type { ColumnDef } from '@tanstack/react-table'
import type { AgentId, PlatformId } from '../types'
import { metricSummaryText, primaryMetric } from '../components/accounts/quota-display'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { DataTable } from '@/components/ui/data-table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { DateRangePicker } from '../features/dashboard/components/DateRangePicker'
import { presetRange, toWindow, type TimeRange } from '../features/dashboard/utils/time-range'
import { PlatformIcon } from '../components/accounts/PlatformIcon'
import { maskEmailText } from '../components/accounts/identity-mask'

const HIDE_EMAILS_KEY = 'hxg:pool:hide-emails'

// ─── runtime state badge ──────────────────────────────────────────────────────

const RUNTIME_STATE_TONE: Record<string, { className: string; dot: string }> = {
  available: {
    className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    dot: 'bg-emerald-500',
  },
  cooldown: {
    className: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400',
    dot: 'bg-yellow-500',
  },
  rate_limited: {
    className: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
    dot: 'bg-amber-500',
  },
  quota_exhausted: {
    className: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
    dot: 'bg-orange-500',
  },
  suspended: { className: 'bg-rose-500/10 text-rose-600 dark:text-rose-400', dot: 'bg-rose-500' },
}

function RuntimeStateBadge({ state, label }: { state: string; label: string }) {
  const tone = RUNTIME_STATE_TONE[state] ?? {
    className: 'bg-zinc-500/10 text-zinc-600',
    dot: 'bg-zinc-400',
  }
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1 rounded-[6px] px-1.5 text-[11px] font-medium',
        tone.className,
      )}
    >
      <span className={cn('size-1.5 rounded-full', tone.dot)} aria-hidden />
      {label}
    </span>
  )
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function useStateLabel() {
  const { t } = useTranslation('nav')
  const now = Date.now()
  return (row: AccountPoolHealthRow): string => {
    let label = t(`poolHealth.state.${row.runtimeState}`)
    if (row.runtimeState === 'cooldown' && row.cooldownUntilMs !== undefined) {
      const remaining = Math.max(0, Math.ceil((row.cooldownUntilMs - now) / 1000))
      label = `${label} (${remaining}s)`
    } else if (row.runtimeState === 'rate_limited' && row.rateLimitedUntilMs !== undefined) {
      const remaining = Math.max(0, Math.ceil((row.rateLimitedUntilMs - now) / 1000))
      label = `${label} (${remaining}s)`
    } else if (row.runtimeState === 'quota_exhausted' && row.quotaResetsAtMs !== undefined) {
      const resetAt = new Date(row.quotaResetsAtMs).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })
      label = `${label} → ${resetAt}`
    }
    return label
  }
}

const successRate = (r: AccountPoolHealthRow) => (r.requests > 0 ? r.success / r.requests : 0)
const fmtPct = (v: number) => `${(v * 100).toFixed(0)}%`
const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`)
const fmtTokens = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
const isSuspended = (r: AccountPoolHealthRow) =>
  r.runtimeState === 'suspended' || r.status === 'SUSPENDED'

/** Token 展示：↓输入 ↑输出 + ⚡缓存（与路由日志同款）。 */
function TokenCell({ row, align }: { row: AccountPoolHealthRow; align?: 'end' }) {
  if (row.inputTokens === 0 && row.outputTokens === 0 && row.cacheTokens === 0) {
    return (
      <span className={cn('text-muted-foreground', align === 'end' && 'block text-right')}>—</span>
    )
  }
  return (
    <div className={cn('flex flex-col gap-0.5', align === 'end' ? 'items-end' : 'items-start')}>
      <span className="flex items-center gap-1.5 text-[12px] tabular-nums">
        <span className="text-emerald-600 dark:text-emerald-400">↓{fmtTokens(row.inputTokens)}</span>
        <span className="text-blue-600 dark:text-blue-400">↑{fmtTokens(row.outputTokens)}</span>
      </span>
      {row.cacheTokens > 0 && (
        <span className="text-[10px] tabular-nums text-muted-foreground">
          ⚡{fmtTokens(row.cacheTokens)}
        </span>
      )}
    </div>
  )
}

// ─── main page ────────────────────────────────────────────────────────────────

export default function ApiProxyHealth() {
  const { t } = useTranslation('nav')
  const { error, poolHealth, fetchPoolHealth, setPooled, setPriority, setConcurrency, setRateLimitCooldown, clearSuspension } =
    useApiProxyStore()
  const stateLabel = useStateLabel()
  // 复用账号管理的额度：账号库（取 Account 供额度兜底/口径）+ 额度状态（按账号缓存）。
  const accountsMap = useAccountStore((s) => s.accounts)
  const fetchAccounts = useAccountStore((s) => s.fetchAccounts)
  const quotaStates = useQuotaStateStore((s) => s.states)
  const ensureQuota = useQuotaStateStore((s) => s.ensureMany)

  const [range, setRange] = useState<TimeRange>(() => presetRange('7d', Date.now()))
  const [view, setView] = useState<'card' | 'table'>('card')
  const [hideEmails, setHideEmails] = useState(() => localStorage.getItem(HIDE_EMAILS_KEY) === '1')
  const [addOpen, setAddOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [batchCooldownOpen, setBatchCooldownOpen] = useState(false)

  // 池账号变化后：按平台拉账号库（供额度兜底/计划字段）+ 拉取各账号额度状态。
  const poolIdsKey = poolHealth.map((r) => r.accountId).join(',')
  useEffect(() => {
    if (poolHealth.length === 0) return
    const platforms = [...new Set(poolHealth.map((r) => r.platform))]
    platforms.forEach((p) => void fetchAccounts(p as AgentId))
    void ensureQuota(poolHealth.map((r) => r.accountId))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poolIdsKey])

  // 额度查询：合并账号库 Account（兜底/口径）+ 额度状态 → 紧凑摘要 + 主指标百分比。
  const quotaInfo = (row: AccountPoolHealthRow) => {
    const acct = accountsMap.get(row.platform as AgentId)?.find((a) => a.id === row.accountId)
    const qs = quotaStates.get(row.accountId)
    const metric = primaryMetric(qs)
    const pct =
      metric === undefined
        ? undefined
        : metric.kind === 'remaining'
          ? (metric.percentRemaining ?? metric.percentUsed)
          : (metric.percentUsed ?? metric.percentRemaining)
    return { text: metricSummaryText(qs, acct), pct: typeof pct === 'number' ? pct : undefined }
  }

  useEffect(() => {
    void fetchPoolHealth(toWindow(range))
  }, [range, fetchPoolHealth])

  useEffect(() => {
    if (error) toast.error(error)
  }, [error])

  const mask = (v: string) => (hideEmails ? maskEmailText(v) : v)
  const pooled = useMemo(() => poolHealth.filter((r) => r.pooled), [poolHealth])
  const candidates = useMemo(() => poolHealth.filter((r) => !r.pooled), [poolHealth])
  const poolEmpty = poolHealth.length > 0 && pooled.length === 0

  const toggleHideEmails = () => {
    setHideEmails((prev) => {
      const next = !prev
      localStorage.setItem(HIDE_EMAILS_KEY, next ? '1' : '0')
      return next
    })
  }

  const columns = useMemo<ColumnDef<AccountPoolHealthRow>[]>(
    () => [
      {
        id: 'account',
        size: 320,
        header: () => t('poolHealth.colAccount'),
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <PlatformIcon
              platform={row.original.platform as PlatformId}
              className="size-6 shrink-0 rounded-[6px]"
            />
            <span
              className="block max-w-[180px] truncate font-medium text-foreground"
              title={mask(row.original.email)}
            >
              {mask(row.original.email)}
            </span>
            <RuntimeStateBadge state={row.original.runtimeState} label={stateLabel(row.original)} />
          </div>
        ),
      },
      {
        id: 'priority',
        size: 118,
        header: () => t('poolHealth.colPriority'),
        cell: ({ row }) => (
          <NumberStepper
            value={row.original.priority}
            min={0}
            title={t('poolHealth.priorityTip')}
            onChange={(v) => void setPriority(row.original.accountId, v)}
          />
        ),
      },
      {
        id: 'concurrency',
        size: 118,
        header: () => t('poolHealth.colConcurrency'),
        cell: ({ row }) => (
          <NumberStepper
            value={row.original.concurrency}
            min={1}
            title={t('poolHealth.concurrencyTip')}
            onChange={(v) => void setConcurrency(row.original.accountId, v)}
          />
        ),
      },
      {
        id: 'requests',
        size: 84,
        header: () => <span className="block text-right">{t('poolHealth.colRequests')}</span>,
        cell: ({ row }) => (
          <span className="block text-right tabular-nums">
            {row.original.requests.toLocaleString('en-US')}
          </span>
        ),
      },
      {
        id: 'success',
        size: 84,
        header: () => <span className="block text-right">{t('poolHealth.colSuccess')}</span>,
        cell: ({ row }) => (
          <span className="block text-right tabular-nums text-emerald-600 dark:text-emerald-400">
            {row.original.success.toLocaleString('en-US')}
          </span>
        ),
      },
      {
        id: 'failed',
        size: 84,
        header: () => <span className="block text-right">{t('poolHealth.colFailed')}</span>,
        cell: ({ row }) => (
          <span
            className={cn(
              'block text-right tabular-nums',
              row.original.failed > 0
                ? 'text-rose-600 dark:text-rose-400'
                : 'text-muted-foreground',
            )}
          >
            {row.original.failed.toLocaleString('en-US')}
          </span>
        ),
      },
      {
        id: 'rateLimited',
        size: 84,
        header: () => <span className="block text-right">{t('poolHealth.colRateLimited')}</span>,
        cell: ({ row }) => (
          <span
            className={cn(
              'block text-right tabular-nums',
              row.original.rateLimited > 0
                ? 'text-orange-600 dark:text-orange-400'
                : 'text-muted-foreground',
            )}
          >
            {row.original.rateLimited.toLocaleString('en-US')}
          </span>
        ),
      },
      {
        id: 'successRate',
        size: 90,
        header: () => <span className="block text-right">{t('poolHealth.colSuccessRate')}</span>,
        cell: ({ row }) => (
          <span className="block text-right tabular-nums text-muted-foreground">
            {row.original.requests > 0 ? fmtPct(successRate(row.original)) : '—'}
          </span>
        ),
      },
      {
        id: 'avgLatency',
        size: 100,
        header: () => <span className="block text-right">{t('poolHealth.colAvgLatency')}</span>,
        cell: ({ row }) => (
          <span className="block text-right tabular-nums text-muted-foreground">
            {row.original.requests > 0 ? fmtMs(row.original.avgDurationMs) : '—'}
          </span>
        ),
      },
      {
        id: 'rpm',
        size: 90,
        header: () => <span className="block text-right">{t('poolHealth.colRpm')}</span>,
        cell: ({ row }) => (
          <span className="block text-right tabular-nums text-muted-foreground">
            {row.original.requests > 0 ? row.original.peakRpm.toLocaleString('en-US') : '—'}
          </span>
        ),
      },
      {
        id: 'tokens',
        size: 140,
        header: () => <span className="block text-right">{t('poolHealth.colTokens')}</span>,
        cell: ({ row }) => <TokenCell row={row.original} align="end" />,
      },
      {
        id: 'quota',
        size: 180,
        header: () => t('poolHealth.colQuota'),
        cell: ({ row }) => {
          const q = quotaInfo(row.original)
          return (
            <span
              className="block max-w-[164px] truncate text-[12px] text-muted-foreground"
              title={q.text}
            >
              {q.text}
            </span>
          )
        },
      },
      {
        id: 'actions',
        size: 140,
        header: () => <span className="block text-right">{t('poolHealth.colActions')}</span>,
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-1">
            {isSuspended(row.original) && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-[12px]"
                onClick={() => void clearSuspension(row.original.accountId)}
              >
                {t('poolHealth.clearSuspension')}
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-600 dark:hover:text-rose-400"
              onClick={() => void setPooled(row.original.accountId, false)}
              aria-label={t('poolHealth.removeFromPool')}
              title={t('poolHealth.removeFromPool')}
            >
              <Trash2 className="size-4" aria-hidden />
            </Button>
          </div>
        ),
      },
    ],
    // mask 依赖 hideEmails；额度列依赖 accountsMap/quotaStates（变化时重建列以刷新额度）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      t,
      stateLabel,
      setPooled,
      setPriority,
      setConcurrency,
      clearSuspension,
      hideEmails,
      accountsMap,
      quotaStates,
    ],
  )

  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      {/* ── header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-[9px] bg-primary/10">
          <Activity className="size-4.5 text-primary" strokeWidth={1.85} aria-hidden />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-semibold text-foreground leading-5">
            {t('poolHealth.title')}
          </div>
          <div className="mt-0.5 text-[12px] text-muted-foreground">{t('poolHealth.subtitle')}</div>
        </div>
        <DateRangePicker value={range} onChange={setRange} />
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5"
          onClick={toggleHideEmails}
          aria-label={hideEmails ? t('poolHealth.showEmails') : t('poolHealth.hideEmails')}
        >
          {hideEmails ? (
            <EyeOff className="size-3.5" aria-hidden />
          ) : (
            <Eye className="size-3.5" aria-hidden />
          )}
        </Button>
        <div className="inline-flex h-8 shrink-0 overflow-hidden rounded-[8px] border border-input bg-card">
          <button
            type="button"
            aria-label={t('poolHealth.viewCard')}
            aria-pressed={view === 'card'}
            onClick={() => setView('card')}
            className={cn(
              'inline-flex size-8 items-center justify-center border-r border-border text-muted-foreground hover:bg-muted/50 hover:text-foreground',
              view === 'card' && 'bg-primary/10 text-primary',
            )}
          >
            <LayoutGrid className="size-3.5" strokeWidth={2} />
          </button>
          <button
            type="button"
            aria-label={t('poolHealth.viewTable')}
            aria-pressed={view === 'table'}
            onClick={() => setView('table')}
            className={cn(
              'inline-flex size-8 items-center justify-center text-muted-foreground hover:bg-muted/50 hover:text-foreground',
              view === 'table' && 'bg-primary/10 text-primary',
            )}
          >
            <Table2 className="size-3.5" strokeWidth={2} />
          </button>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5"
          onClick={() => void fetchPoolHealth(toWindow(range))}
        >
          <RefreshCw className="size-3.5" aria-hidden />
          {t('poolHealth.refresh')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings2 className="size-3.5" aria-hidden />
          {t('poolHealth.settings')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5"
          disabled={pooled.length === 0}
          onClick={() => setBatchCooldownOpen(true)}
        >
          <Timer className="size-3.5" aria-hidden />
          {t('poolHealth.batchCooldown')}
        </Button>
        <Button size="sm" className="h-8 gap-1.5" onClick={() => setAddOpen(true)}>
          <Plus className="size-3.5" strokeWidth={2.25} aria-hidden />
          {t('poolHealth.add')}
        </Button>
      </div>

      {/* ── summary pills ───────────────────────────────────────────────── */}
      {poolHealth.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 font-medium text-primary">
            {t('poolHealth.summaryPooled', { count: pooled.length })}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-muted/60 px-2.5 py-1 text-muted-foreground">
            <Users className="size-3.5" strokeWidth={1.9} aria-hidden />
            {t('poolHealth.summaryCandidates', { count: candidates.length })}
          </span>
        </div>
      )}

      {/* ── empty-pool warning (all requests 503) ───────────────────────── */}
      {poolEmpty && (
        <div className="flex items-center gap-2 rounded-[8px] border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-700 dark:text-amber-400">
          <TriangleAlert className="size-4 shrink-0" strokeWidth={1.9} aria-hidden />
          {t('poolHealth.emptyPoolWarning')}
        </div>
      )}

      {/* ── content ─────────────────────────────────────────────────────── */}
      {pooled.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-[8px] border border-border bg-card py-14">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted">
            <Users className="size-5 text-muted-foreground" strokeWidth={1.85} />
          </div>
          <div className="space-y-1 text-center">
            <p className="text-sm font-medium text-foreground">{t('poolHealth.emptyPool')}</p>
            <p className="text-xs text-muted-foreground">
              {poolHealth.length === 0
                ? t('poolHealth.emptyNoCandidates')
                : t('poolHealth.emptyHint')}
            </p>
          </div>
          {candidates.length > 0 && (
            <Button size="sm" className="gap-1.5" onClick={() => setAddOpen(true)}>
              <Plus className="size-3.5" strokeWidth={2.25} aria-hidden />
              {t('poolHealth.add')}
            </Button>
          )}
        </div>
      ) : view === 'table' ? (
        <DataTable
          columns={columns}
          data={pooled}
          getRowId={(r) => r.accountId}
          tableClassName="min-w-[1620px]"
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {pooled.map((row) => (
            <AccountCard
              key={row.accountId}
              row={row}
              email={mask(row.email)}
              stateLabel={stateLabel(row)}
              quota={quotaInfo(row)}
              onTogglePooled={(v) => void setPooled(row.accountId, v)}
              onSetPriority={(v) => void setPriority(row.accountId, v)}
              onSetConcurrency={(v) => void setConcurrency(row.accountId, v)}
              onClearSuspension={() => void clearSuspension(row.accountId)}
            />
          ))}
        </div>
      )}

      <AddAccountsDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        candidates={candidates}
        mask={mask}
        onConfirm={(entries) => {
          void (async () => {
            for (const { id, priority } of entries) {
              await setPooled(id, true)
              if (priority > 0) await setPriority(id, priority)
            }
          })()
        }}
      />

      <ProxySettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />

      <BatchCooldownDialog
        open={batchCooldownOpen}
        onOpenChange={setBatchCooldownOpen}
        accounts={pooled}
        mask={mask}
        onConfirm={(ids, ms) => void setRateLimitCooldown(ids, ms)}
      />
    </div>
  )
}

// ─── number stepper (priority / concurrency, table + card) ───────────────────

function NumberStepper({
  value,
  min = 0,
  title,
  onChange,
}: {
  value: number
  min?: number
  title?: string
  onChange: (v: number) => void
}) {
  return (
    <div className="inline-flex items-center gap-1" title={title}>
      <button
        type="button"
        aria-label="-"
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
        className="inline-flex size-6 items-center justify-center rounded-[6px] border border-input text-muted-foreground hover:bg-muted/50 disabled:opacity-40"
      >
        <Minus className="size-3" strokeWidth={2.25} />
      </button>
      <span className="min-w-[1.5rem] text-center text-[12px] font-medium tabular-nums text-foreground">
        {value}
      </span>
      <button
        type="button"
        aria-label="+"
        onClick={() => onChange(value + 1)}
        className="inline-flex size-6 items-center justify-center rounded-[6px] border border-input text-muted-foreground hover:bg-muted/50"
      >
        <Plus className="size-3" strokeWidth={2.25} />
      </button>
    </div>
  )
}

// ─── proxy selection settings dialog (global pool policy) ────────────────────

function ProxySettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation('nav')
  const selectionConfig = useApiProxyStore((s) => s.selectionConfig)
  const fetchSelectionConfig = useApiProxyStore((s) => s.fetchSelectionConfig)
  const saveSelectionConfig = useApiProxyStore((s) => s.saveSelectionConfig)

  const [strategy, setStrategy] = useState<ApiProxySelectionConfigDto['strategy']>('sticky-lru')
  const [affinitySec, setAffinitySec] = useState('60')
  const [rateLimitCooldownSec, setRateLimitCooldownSec] = useState('60')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) void fetchSelectionConfig()
  }, [open, fetchSelectionConfig])

  useEffect(() => {
    if (open && selectionConfig) {
      setStrategy(selectionConfig.strategy)
      setAffinitySec(String(Math.round(selectionConfig.affinityTtlMs / 1000)))
      setRateLimitCooldownSec(String(Math.round(selectionConfig.rateLimitCooldownMs / 1000)))
    }
  }, [open, selectionConfig])

  const save = async () => {
    setSaving(true)
    const ok = await saveSelectionConfig({
      strategy,
      affinityTtlMs: Math.max(0, Math.round(Number(affinitySec) || 0)) * 1000,
      rateLimitCooldownMs: Math.max(0, Math.round(Number(rateLimitCooldownSec) || 0)) * 1000,
    })
    setSaving(false)
    if (ok) {
      toast.success(t('poolHealth.settingsSaved'))
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('poolHealth.settingsTitle')}</DialogTitle>
          <DialogDescription>{t('poolHealth.settingsDesc')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-1">
          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-foreground">
              {t('poolHealth.settingsStrategy')}
            </span>
            <Select
              value={strategy}
              onValueChange={(v) => setStrategy(v as ApiProxySelectionConfigDto['strategy'])}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sticky-lru">
                  {t('poolHealth.settingsStrategySticky')}
                </SelectItem>
                <SelectItem value="round-robin">
                  {t('poolHealth.settingsStrategyRoundRobin')}
                </SelectItem>
              </SelectContent>
            </Select>
            <span className="text-[11px] text-muted-foreground">
              {t('poolHealth.settingsStrategyHint')}
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-foreground">
              {t('poolHealth.settingsAffinity')}
            </span>
            <Input
              type="number"
              min={0}
              value={affinitySec}
              onChange={(e) => setAffinitySec(e.target.value)}
            />
            <span className="text-[11px] text-muted-foreground">
              {t('poolHealth.settingsAffinityHint')}
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-foreground">
              {t('poolHealth.settingsRateLimitCooldown')}
            </span>
            <Input
              type="number"
              min={0}
              value={rateLimitCooldownSec}
              onChange={(e) => setRateLimitCooldownSec(e.target.value)}
            />
            <span className="text-[11px] text-muted-foreground">
              {t('poolHealth.settingsRateLimitCooldownHint')}
            </span>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            {t('poolHealth.settingsCancel')}
          </Button>
          <Button size="sm" disabled={saving} onClick={() => void save()}>
            {t('poolHealth.settingsSave')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── batch rate-limit cooldown dialog ───────────────────────────────────────

function BatchCooldownDialog({
  open,
  onOpenChange,
  accounts,
  mask,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  accounts: AccountPoolHealthRow[]
  mask: (v: string) => string
  onConfirm: (ids: string[], rateLimitCooldownMs: number) => void
}) {
  const { t } = useTranslation('nav')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [sec, setSec] = useState('60')

  useEffect(() => {
    if (open) {
      setSelected(new Set())
      setSec('60')
    }
  }, [open])

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const allSelected = accounts.length > 0 && selected.size === accounts.length
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(accounts.map((a) => a.accountId)))

  // 覆盖值展示：0=用全局；<0=不冷却；>0=秒。
  const fmtOverride = (ms: number): string =>
    ms === 0 ? t('poolHealth.cooldownGlobal') : ms < 0 ? t('poolHealth.cooldownNone') : `${Math.round(ms / 1000)}s`

  const confirm = () => {
    const raw = Math.trunc(Number(sec))
    const ms = !Number.isFinite(raw) ? 0 : raw < 0 ? -1 : raw * 1000
    onConfirm([...selected], ms)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('poolHealth.batchDialog.title')}</DialogTitle>
          <DialogDescription>{t('poolHealth.batchDialog.desc')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-foreground">
            {t('poolHealth.batchDialog.cooldownLabel')}
          </span>
          <Input type="number" value={sec} onChange={(e) => setSec(e.target.value)} />
          <span className="text-[11px] text-muted-foreground">
            {t('poolHealth.batchDialog.cooldownHint')}
          </span>
        </div>
        {accounts.length === 0 ? (
          <div className="py-8 text-center text-[12px] text-muted-foreground">
            {t('poolHealth.addDialog.empty')}
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={toggleAll}
              className="flex items-center gap-2 self-start text-[12px] text-primary hover:underline"
            >
              <Checkbox checked={allSelected} aria-hidden />
              {t('poolHealth.batchDialog.selectAll')}
            </button>
            <div className="max-h-[260px] overflow-y-auto rounded-[8px] border border-border">
              {accounts.map((c) => {
                const isSel = selected.has(c.accountId)
                return (
                  <button
                    key={c.accountId}
                    type="button"
                    onClick={() => toggle(c.accountId)}
                    className="flex w-full items-center gap-2.5 border-b border-border/60 px-3 py-2 text-left last:border-b-0 hover:bg-muted/40"
                  >
                    <Checkbox checked={isSel} aria-hidden />
                    <PlatformIcon
                      platform={c.platform as PlatformId}
                      className="size-6 shrink-0 rounded-[6px]"
                    />
                    <span
                      className="min-w-0 flex-1 truncate text-[12.5px] text-foreground"
                      title={mask(c.email)}
                    >
                      {mask(c.email)}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {fmtOverride(c.rateLimitCooldownMs)}
                    </span>
                  </button>
                )
              })}
            </div>
          </>
        )}
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            {t('poolHealth.settingsCancel')}
          </Button>
          <Button size="sm" disabled={selected.size === 0} onClick={confirm}>
            {t('poolHealth.batchDialog.confirm', { count: selected.size })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── add-accounts picker dialog ─────────────────────────────────────────────

function AddAccountsDialog({
  open,
  onOpenChange,
  candidates,
  mask,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  candidates: AccountPoolHealthRow[]
  mask: (v: string) => string
  onConfirm: (entries: Array<{ id: string; priority: number }>) => void
}) {
  const { t } = useTranslation('nav')
  // 选中集合 + 每个选中账号的优先级（id → priority）。
  const [selected, setSelected] = useState<Map<string, number>>(new Map())

  useEffect(() => {
    if (open) setSelected(new Map())
  }, [open])

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Map(prev)
      if (next.has(id)) next.delete(id)
      else next.set(id, 0)
      return next
    })

  const setPriorityFor = (id: string, priority: number) =>
    setSelected((prev) => {
      if (!prev.has(id)) return prev
      const next = new Map(prev)
      next.set(id, priority)
      return next
    })

  const confirm = () => {
    onConfirm([...selected].map(([id, priority]) => ({ id, priority })))
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('poolHealth.addDialog.title')}</DialogTitle>
          <DialogDescription>{t('poolHealth.addDialog.desc')}</DialogDescription>
        </DialogHeader>
        {candidates.length === 0 ? (
          <div className="py-8 text-center text-[12px] text-muted-foreground">
            {t('poolHealth.addDialog.empty')}
          </div>
        ) : (
          <div className="max-h-[320px] overflow-y-auto rounded-[8px] border border-border">
            {candidates.map((c) => {
              const isSel = selected.has(c.accountId)
              return (
                <div
                  key={c.accountId}
                  className="flex items-center gap-2.5 border-b border-border/60 px-3 py-2 last:border-b-0 hover:bg-muted/40"
                >
                  <button
                    type="button"
                    onClick={() => toggle(c.accountId)}
                    className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                  >
                    <Checkbox checked={isSel} aria-hidden />
                    <PlatformIcon
                      platform={c.platform as PlatformId}
                      className="size-6 shrink-0 rounded-[6px]"
                    />
                    <span
                      className="min-w-0 flex-1 truncate text-[12.5px] text-foreground"
                      title={mask(c.email)}
                    >
                      {mask(c.email)}
                    </span>
                  </button>
                  {isSel && (
                    <div className="flex shrink-0 items-center gap-1.5">
                      <span className="text-[11px] text-muted-foreground">
                        {t('poolHealth.colPriority')}
                      </span>
                      <NumberStepper
                        value={selected.get(c.accountId) ?? 0}
                        min={0}
                        title={t('poolHealth.priorityTip')}
                        onChange={(v) => setPriorityFor(c.accountId, v)}
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            {t('poolHealth.addDialog.cancel')}
          </Button>
          <Button size="sm" disabled={selected.size === 0} onClick={confirm}>
            {t('poolHealth.addDialog.confirm', { count: selected.size })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── account card (card view) ───────────────────────────────────────────────

function AccountCard({
  row,
  email,
  stateLabel,
  quota,
  onTogglePooled,
  onSetPriority,
  onSetConcurrency,
  onClearSuspension,
}: {
  row: AccountPoolHealthRow
  email: string
  stateLabel: string
  quota: { text: string; pct?: number }
  onTogglePooled: (v: boolean) => void
  onSetPriority: (v: number) => void
  onSetConcurrency: (v: number) => void
  onClearSuspension: () => void
}) {
  const { t } = useTranslation('nav')
  return (
    <div className="flex flex-col gap-3 rounded-[12px] border border-primary/30 bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <PlatformIcon
            platform={row.platform as PlatformId}
            className="size-8 shrink-0 rounded-[7px]"
          />
          <span className="truncate text-[13px] font-medium text-foreground" title={email}>
            {email}
          </span>
          <RuntimeStateBadge state={row.runtimeState} label={stateLabel} />
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-600 dark:hover:text-rose-400"
          onClick={() => onTogglePooled(false)}
          aria-label={t('poolHealth.removeFromPool')}
          title={t('poolHealth.removeFromPool')}
        >
          <Trash2 className="size-4" aria-hidden />
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-2 rounded-[8px] bg-muted/40 py-2">
        <Stat label={t('poolHealth.colRequests')} value={row.requests.toLocaleString('en-US')} />
        <Stat
          label={t('poolHealth.colSuccess')}
          value={row.success.toLocaleString('en-US')}
          tone="text-emerald-600 dark:text-emerald-400"
        />
        <Stat
          label={t('poolHealth.colFailed')}
          value={row.failed.toLocaleString('en-US')}
          tone={row.failed > 0 ? 'text-rose-600 dark:text-rose-400' : undefined}
        />
      </div>

      <div className="flex items-center justify-between gap-3 text-[11px]">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">{t('poolHealth.colPriority')}</span>
          <NumberStepper
            value={row.priority}
            min={0}
            title={t('poolHealth.priorityTip')}
            onChange={onSetPriority}
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">{t('poolHealth.colConcurrency')}</span>
          <NumberStepper
            value={row.concurrency}
            min={1}
            title={t('poolHealth.concurrencyTip')}
            onChange={onSetConcurrency}
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="text-muted-foreground">{t('poolHealth.colTokens')}</span>
        <TokenCell row={row} align="end" />
      </div>

      {/* 额度（来自账号管理）：紧凑摘要 + 主指标进度条 */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2 text-[11px]">
          <span className="text-muted-foreground">{t('poolHealth.colQuota')}</span>
          <span className="truncate font-medium text-foreground" title={quota.text}>
            {quota.text}
          </span>
        </div>
        {quota.pct !== undefined && (
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${Math.max(0, Math.min(100, quota.pct))}%` }}
            />
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span>
          {t('poolHealth.colSuccessRate')}：
          <span className="tabular-nums text-foreground">
            {row.requests > 0 ? fmtPct(successRate(row)) : '—'}
          </span>
        </span>
        <span>
          {t('poolHealth.colAvgLatency')}：
          <span className="tabular-nums text-foreground">
            {row.requests > 0 ? fmtMs(row.avgDurationMs) : '—'}
          </span>
        </span>
        <span>
          {t('poolHealth.colRpm')}：
          <span className="tabular-nums text-foreground">
            {row.requests > 0 ? row.peakRpm.toLocaleString('en-US') : '—'}
          </span>
        </span>
        <span>
          {t('poolHealth.colRateLimited')}：
          <span
            className={cn(
              'tabular-nums',
              row.rateLimited > 0 ? 'text-orange-600 dark:text-orange-400' : 'text-foreground',
            )}
          >
            {row.rateLimited.toLocaleString('en-US')}
          </span>
        </span>
      </div>

      {isSuspended(row) && (
        <Button
          variant="outline"
          size="sm"
          className="h-7 w-full text-[12px]"
          onClick={onClearSuspension}
        >
          {t('poolHealth.clearSuspension')}
        </Button>
      )}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span
        className={cn(
          'text-[15px] font-semibold tabular-nums leading-5',
          tone ?? 'text-foreground',
        )}
      >
        {value}
      </span>
      <span className="text-[10px] text-muted-foreground">{label}</span>
    </div>
  )
}
