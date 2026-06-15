import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts'
import {
  Activity,
  AlertTriangle,
  BarChart3,
  RefreshCw,
  Route as RouteIcon,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { useRoutingLogStore } from '../stores/routingLogStore'
import type { RoutingBreakdownDimDto, RoutingRecentRowDto } from '@shared/api-types'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import {
  Tooltip as UITooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { DataTable } from '@/components/ui/data-table'
import type { ColumnDef } from '@tanstack/react-table'
import { cn } from '@/lib/utils'
import { useThemeValue } from '@/hooks/use-theme'
import { DateRangePicker } from '../features/dashboard/components/DateRangePicker'
import { VIZ } from '../features/dashboard/datawall/viz-colors'
import {
  presetRange,
  granularityFor,
  toWindow,
  type TimeRange,
} from '../features/dashboard/utils/time-range'

// ── formatters ────────────────────────────────────────────────────────────────

const fmtInt = (n: number) => n.toLocaleString('en-US')
const fmtPct = (r: number) => `${(r * 100).toFixed(1)}%`
const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`)
const fmtTokens = (n: number) =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(2)}M`
    : n >= 1000
      ? `${(n / 1000).toFixed(1)}k`
      : String(n)
/** RPM：≥10 取整（带千分位），否则保留 1 位小数（长窗口下均值常 <1）。 */
const fmtRpm = (n: number) => (n >= 10 ? fmtInt(Math.round(n)) : n.toFixed(1))
const p2 = (n: number) => String(n).padStart(2, '0')
/** 完整本地日期时间 "YYYY/MM/DD HH:mm:ss"（与截图时间列同款）。 */
const fmtDateTime = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}/${p2(d.getMonth() + 1)}/${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`
}

/** "YYYY-MM-DD HH:00" / "YYYY-MM-DD" → 去掉年份的短标签。 */
const shortLabel = (date: string) => (date.length >= 5 ? date.slice(5) : date)

const DIMENSIONS: RoutingBreakdownDimDto[] = ['platform', 'combo', 'model', 'status', 'account']

const RECENT_FILTERS = ['all', 'ok', 'failed'] as const
type RecentFilterMode = (typeof RECENT_FILTERS)[number]

// ── status badge ────────────────────────────────────────────────────────────────

function statusTone(status: number, ok: boolean): { className: string; dot: string } {
  if (ok && status >= 200 && status < 300)
    return {
      className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
      dot: 'bg-emerald-500',
    }
  if (status >= 500 || status === 0)
    return { className: 'bg-rose-500/10 text-rose-600 dark:text-rose-400', dot: 'bg-rose-500' }
  if (status >= 400)
    return { className: 'bg-amber-500/10 text-amber-600 dark:text-amber-400', dot: 'bg-amber-500' }
  return { className: 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400', dot: 'bg-zinc-400' }
}

// ── KPI card ──────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string
  value: string
  sub?: string
  tone?: 'good' | 'bad' | 'neutral'
}) {
  const valueColor =
    tone === 'good'
      ? 'text-emerald-600 dark:text-emerald-400'
      : tone === 'bad'
        ? 'text-rose-600 dark:text-rose-400'
        : 'text-foreground'
  return (
    <div className="rounded-[12px] border border-border bg-card px-4 py-3">
      <p className="text-[11px] leading-4 text-muted-foreground">{label}</p>
      <p className={cn('mt-1 text-[20px] font-semibold leading-6 tabular-nums', valueColor)}>
        {value}
      </p>
      {sub != null && (
        <p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">{sub}</p>
      )}
    </div>
  )
}

// ── trend tooltip ─────────────────────────────────────────────────────────────

interface TrendTipProps {
  active?: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: ReadonlyArray<{ payload?: any }>
  label?: string | number
}
function TrendTooltip({ active, payload, label }: TrendTipProps) {
  const { t } = useTranslation('nav')
  if (!active || !payload?.length) return null
  const p = payload[0]?.payload as
    | { success?: number; failed?: number; requests?: number; avgDurationMs?: number }
    | undefined
  if (!p) return null
  const rows = [
    { label: t('routingLog.trend.success'), color: VIZ.green, val: fmtInt(p.success ?? 0) },
    { label: t('routingLog.trend.failed'), color: VIZ.red, val: fmtInt(p.failed ?? 0) },
    { label: t('routingLog.trend.avgLatency'), color: VIZ.gray, val: fmtMs(p.avgDurationMs ?? 0) },
  ]
  return (
    <div className="rounded-[8px] border border-border bg-card px-3 py-2 shadow-md min-w-[140px]">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <div className="mt-1 flex flex-col gap-0.5">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <span className="size-1.5 rounded-full shrink-0" style={{ background: row.color }} />
              {row.label}
            </span>
            <span className="text-[11px] font-medium tabular-nums text-foreground">{row.val}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── main page ─────────────────────────────────────────────────────────────────

export default function ApiProxyLogs() {
  const { t } = useTranslation('nav')
  const theme = useThemeValue()
  const {
    summary,
    trend,
    breakdown,
    errors,
    recent,
    error,
    fetchOverview,
    fetchBreakdown,
    fetchRecent,
    clear,
  } = useRoutingLogStore()

  const [range, setRange] = useState<TimeRange>(() => presetRange('7d', Date.now()))
  const [dimension, setDimension] = useState<RoutingBreakdownDimDto>('platform')
  const [recentMode, setRecentMode] = useState<RecentFilterMode>('all')
  const [nonce, setNonce] = useState(0)

  const recentFilter = useMemo(
    () => ({ okOnly: recentMode === 'ok', failedOnly: recentMode === 'failed' }),
    [recentMode],
  )

  // 范围/手动刷新 → 概览 + 下钻 + 最近。
  useEffect(() => {
    const window = toWindow(range)
    void fetchOverview(window, granularityFor(range))
    void fetchBreakdown(window, dimension)
    void fetchRecent(200, recentFilter)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, nonce])

  useEffect(() => {
    void fetchBreakdown(toWindow(range), dimension)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dimension])

  useEffect(() => {
    void fetchRecent(200, recentFilter)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentMode])

  useEffect(() => {
    if (error) toast.error(error)
  }, [error])

  const gridColor = theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.06)'
  const tickColor = theme === 'dark' ? 'rgba(255,255,255,0.35)' : 'rgba(15,23,42,0.35)'
  const trendData = useMemo(() => trend.map((p) => ({ ...p, label: shortLabel(p.date) })), [trend])

  // 平均 RPM = 窗口内总请求 / 窗口分钟数（作为峰值 RPM 卡片的副行）。
  const avgRpm = useMemo(() => {
    if (summary == null || summary.requests === 0) return 0
    const w = toWindow(range)
    const minutes = Math.max(1, (w.endSec - w.startSec) / 60)
    return summary.requests / minutes
  }, [summary, range])

  // 最近请求列（字段顺序参考反代请求日志截图：密钥→模型→端点→路由→类型→状态→Token→耗时→时间）。
  const recentColumns = useMemo<ColumnDef<RoutingRecentRowDto>[]>(
    () => [
      {
        id: 'key',
        size: 110,
        header: () => t('routingLog.recent.colKey'),
        cell: ({ row }) => (
          <span
            className="block max-w-[100px] truncate font-mono text-[11px] text-muted-foreground"
            title={row.original.clientKeyId ?? ''}
          >
            {row.original.clientKeyId ?? t('routingLog.recent.anon')}
          </span>
        ),
      },
      {
        id: 'model',
        size: 210,
        header: () => t('routingLog.recent.colModel'),
        cell: ({ row }) => <ModelCell r={row.original} />,
      },
      {
        id: 'endpoint',
        size: 150,
        header: () => t('routingLog.recent.colEndpoint'),
        cell: ({ row }) => (
          <span
            className="block max-w-[150px] truncate font-mono text-[11px] text-muted-foreground"
            title={row.original.path}
          >
            {row.original.path || '—'}
          </span>
        ),
      },
      {
        id: 'route',
        size: 150,
        header: () => t('routingLog.recent.colRoute'),
        cell: ({ row }) => <RouteCell r={row.original} />,
      },
      {
        id: 'type',
        size: 76,
        header: () => t('routingLog.recent.colType'),
        cell: ({ row }) =>
          row.original.stream ? (
            <span className="rounded-[4px] bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 dark:text-blue-400">
              {t('routingLog.recent.typeStream')}
            </span>
          ) : (
            <span className="text-[11px] text-muted-foreground">
              {t('routingLog.recent.typeSync')}
            </span>
          ),
      },
      {
        id: 'status',
        size: 84,
        header: () => t('routingLog.recent.colStatus'),
        cell: ({ row }) => <StatusBadge r={row.original} />,
      },
      {
        id: 'tokens',
        size: 150,
        header: () => <span className="block text-right">{t('routingLog.recent.colTokens')}</span>,
        cell: ({ row }) => <TokenCell r={row.original} />,
      },
      {
        id: 'duration',
        size: 84,
        header: () => <span className="block text-right">{t('routingLog.recent.colLatency')}</span>,
        cell: ({ row }) => (
          <span className="block text-right tabular-nums text-muted-foreground">
            {fmtMs(row.original.durationMs)}
          </span>
        ),
      },
      {
        id: 'time',
        size: 160,
        header: () => t('routingLog.recent.colTime'),
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums text-muted-foreground">
            {fmtDateTime(row.original.tsMs)}
          </span>
        ),
      },
    ],
    [t],
  )

  const handleClear = async () => {
    await clear()
    toast.success(t('routingLog.cleared'))
    setNonce((n) => n + 1)
  }

  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      {/* ── header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-[9px] bg-primary/10">
          <BarChart3 className="size-4.5 text-primary" strokeWidth={1.85} aria-hidden />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-semibold text-foreground leading-5">
            {t('routingLog.title')}
          </div>
          <div className="mt-0.5 text-[12px] text-muted-foreground">{t('routingLog.subtitle')}</div>
        </div>
        <DateRangePicker value={range} onChange={setRange} />
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5"
          onClick={() => setNonce((n) => n + 1)}
        >
          <RefreshCw className="size-3.5" aria-hidden />
          {t('routingLog.refresh')}
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-muted-foreground">
              <Trash2 className="size-3.5" aria-hidden />
              {t('routingLog.clear')}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('routingLog.clearTitle')}</AlertDialogTitle>
              <AlertDialogDescription>{t('routingLog.clearDesc')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('routingLog.cancel')}</AlertDialogCancel>
              <AlertDialogAction onClick={() => void handleClear()}>
                {t('routingLog.confirmClear')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {/* ── KPI strip ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
        <KpiCard label={t('routingLog.kpi.requests')} value={fmtInt(summary?.requests ?? 0)} />
        <KpiCard
          label={t('routingLog.kpi.rpm')}
          value={fmtInt(summary?.peakRpm ?? 0)}
          sub={t('routingLog.kpi.rpmAvg', { avg: fmtRpm(avgRpm) })}
        />
        <KpiCard
          label={t('routingLog.kpi.successRate')}
          value={fmtPct(summary?.successRate ?? 0)}
          tone={
            summary == null || summary.requests === 0
              ? 'neutral'
              : summary.successRate >= 0.95
                ? 'good'
                : summary.successRate >= 0.8
                  ? 'neutral'
                  : 'bad'
          }
          sub={t('routingLog.kpi.failedCount', { count: summary?.failed ?? 0 })}
        />
        <KpiCard
          label={t('routingLog.kpi.avgLatency')}
          value={fmtMs(summary?.avgDurationMs ?? 0)}
          sub={`P95 ${fmtMs(summary?.p95DurationMs ?? 0)}`}
        />
        <KpiCard
          label={t('routingLog.kpi.tokens')}
          value={fmtTokens(summary?.totalTokens ?? 0)}
          sub={`↓${fmtTokens(summary?.inputTokens ?? 0)} ↑${fmtTokens(summary?.outputTokens ?? 0)} ⚡${fmtTokens(
            (summary?.cacheReadTokens ?? 0) + (summary?.cacheWriteTokens ?? 0),
          )}`}
        />
        <KpiCard
          label={t('routingLog.kpi.fallback')}
          value={fmtInt(summary?.fallbackRequests ?? 0)}
          sub={t('routingLog.kpi.fallbackSub')}
        />
        <KpiCard
          label={t('routingLog.kpi.combo')}
          value={fmtInt(summary?.comboRequests ?? 0)}
          sub={t('routingLog.kpi.comboSub')}
        />
      </div>

      {/* ── trend ───────────────────────────────────────────────────────── */}
      <div className="rounded-[14px] border border-border bg-card">
        <div className="flex items-center justify-between px-4 pt-3.5">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t('routingLog.trend.title')}
          </span>
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="size-1.5 rounded-full" style={{ background: VIZ.green }} />
              {t('routingLog.trend.success')}
            </span>
            <span className="flex items-center gap-1">
              <span className="size-1.5 rounded-full" style={{ background: VIZ.red }} />
              {t('routingLog.trend.failed')}
            </span>
          </div>
        </div>
        <div className="h-[220px] px-2 pb-2 pt-3">
          {trendData.length === 0 ? (
            <div className="flex h-full items-center justify-center text-[12px] text-muted-foreground">
              {t('routingLog.empty')}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trendData} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="rl-ok" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={VIZ.green} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={VIZ.green} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="rl-fail" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={VIZ.red} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={VIZ.red} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke={gridColor} />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: tickColor, fontSize: 10 }}
                  interval="preserveStartEnd"
                  minTickGap={32}
                />
                <YAxis hide />
                <Tooltip
                  content={(props) => (
                    <TrendTooltip
                      active={props.active}
                      payload={props.payload as TrendTipProps['payload']}
                      label={props.label}
                    />
                  )}
                  cursor={{ stroke: VIZ.gray, strokeWidth: 1, strokeDasharray: '3 3' }}
                />
                <Area
                  type="monotone"
                  dataKey="success"
                  stackId="1"
                  stroke={VIZ.green}
                  strokeWidth={2}
                  fill="url(#rl-ok)"
                  isAnimationActive={false}
                />
                <Area
                  type="monotone"
                  dataKey="failed"
                  stackId="1"
                  stroke={VIZ.red}
                  strokeWidth={2}
                  fill="url(#rl-fail)"
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* ── breakdown + errors ──────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* breakdown */}
        <div className="rounded-[14px] border border-border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3.5">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t('routingLog.breakdown.title')}
            </span>
            <div className="inline-flex items-center gap-0.5 rounded-full bg-muted/60 p-[3px]">
              {DIMENSIONS.map((dim) => (
                <button
                  key={dim}
                  onClick={() => setDimension(dim)}
                  className={cn(
                    'rounded-full px-2.5 py-1 text-[11px] transition-all',
                    dimension === dim
                      ? 'bg-card font-medium text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                  aria-pressed={dimension === dim}
                >
                  {t(`routingLog.dim.${dim}`)}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1.5 px-4 py-3.5">
            {breakdown.length === 0 ? (
              <div className="py-8 text-center text-[12px] text-muted-foreground">
                {t('routingLog.empty')}
              </div>
            ) : (
              breakdown.slice(0, 10).map((row) => (
                <div key={row.key} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-2 text-[12px]">
                    <span className="truncate font-medium text-foreground" title={row.key}>
                      {row.key}
                    </span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {fmtInt(row.requests)} · {fmtPct(row.successRate)} ·{' '}
                      {fmtMs(row.avgDurationMs)}
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${Math.max(2, row.shareRatio * 100)}%` }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* top errors */}
        <div className="rounded-[14px] border border-border bg-card">
          <div className="flex items-center gap-1.5 px-4 pt-3.5">
            <AlertTriangle className="size-3.5 text-amber-500" strokeWidth={1.9} aria-hidden />
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t('routingLog.errors.title')}
            </span>
          </div>
          <div className="flex flex-col gap-1 px-4 py-3.5">
            {errors.length === 0 ? (
              <div className="py-8 text-center text-[12px] text-muted-foreground">
                {t('routingLog.errors.empty')}
              </div>
            ) : (
              errors.slice(0, 8).map((e, i) => (
                <div
                  key={`${e.message}-${i}`}
                  className="flex items-center justify-between gap-2 rounded-[8px] px-2 py-1.5 hover:bg-muted/40"
                >
                  <span
                    className="min-w-0 flex-1 truncate text-[12px] text-foreground"
                    title={e.message}
                  >
                    <span className="mr-1.5 inline-block rounded-[5px] bg-rose-500/10 px-1 text-[10px] font-medium text-rose-600 dark:text-rose-400 tabular-nums">
                      {e.lastStatus || '—'}
                    </span>
                    {e.message}
                  </span>
                  <span className="shrink-0 text-[11px] font-medium tabular-nums text-muted-foreground">
                    ×{fmtInt(e.count)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* ── recent requests ─────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Activity className="size-3.5 text-primary" strokeWidth={1.9} aria-hidden />
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t('routingLog.recent.title')}
            </span>
          </div>
          <div className="inline-flex items-center gap-0.5 rounded-full bg-muted/60 p-[3px]">
            {RECENT_FILTERS.map((m) => (
              <button
                key={m}
                onClick={() => setRecentMode(m)}
                className={cn(
                  'rounded-full px-2.5 py-1 text-[11px] transition-all',
                  recentMode === m
                    ? 'bg-card font-medium text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                aria-pressed={recentMode === m}
              >
                {t(`routingLog.recent.filter.${m}`)}
              </button>
            ))}
          </div>
        </div>
        <DataTable
          columns={recentColumns}
          data={recent}
          getRowId={(r) => `${r.seq}-${r.tsMs}`}
          tableClassName="min-w-[1080px]"
          emptyState={
            <div className="py-10 text-center text-[12px] text-muted-foreground">
              {t('routingLog.recent.empty')}
            </div>
          }
        />
      </div>
    </div>
  )
}

// ── recent requests cells (DataTable，与 IP 代理 / 分组管理同款表格) ──────────────

/** 模型列：最终模型 + 降级跳数徽章（悬浮显示完整降级链路径）。 */
function ModelCell({ r }: { r: RoutingRecentRowDto }) {
  const { t } = useTranslation('nav')
  const hasFallback = (r.routeHops ?? 1) > 1
  return (
    <div className="flex items-center gap-1">
      <span className="truncate text-foreground" title={r.finalModel ?? r.requestedModel ?? '—'}>
        {r.finalModel ?? r.requestedModel ?? '—'}
      </span>
      {hasFallback && r.routePath != null && r.routePath.length > 0 && (
        <TooltipProvider delayDuration={120}>
          <UITooltip>
            <TooltipTrigger asChild>
              <span className="shrink-0 cursor-default rounded-[4px] bg-amber-500/10 px-1 text-[10px] font-medium tabular-nums text-amber-600 dark:text-amber-400">
                ↘{r.routeHops}
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-[320px]">
              <div className="flex flex-col gap-0.5">
                <span className="text-[11px] font-medium">
                  {t('routingLog.recent.fallbackPath')}
                </span>
                {r.routePath.map((step, i) => (
                  <span key={`${step}-${i}`} className="text-[11px] tabular-nums">
                    {i + 1}. {step}
                  </span>
                ))}
              </div>
            </TooltipContent>
          </UITooltip>
        </TooltipProvider>
      )}
    </div>
  )
}

/** 路由列：命中组合显示 cb/<name> 徽章，否则显示平台名。 */
function RouteCell({ r }: { r: RoutingRecentRowDto }) {
  if (r.comboName != null) {
    return (
      <span className="inline-flex max-w-[140px] items-center gap-1 truncate rounded-[5px] bg-violet-500/10 px-1.5 py-0.5 text-[11px] font-medium text-violet-600 dark:text-violet-400">
        <RouteIcon className="size-3 shrink-0" strokeWidth={2} aria-hidden />
        cb/{r.comboName}
      </span>
    )
  }
  return <span className="text-[12px] text-foreground">{r.platform ?? '—'}</span>
}

/** 状态列：按状态类着色的徽章。 */
function StatusBadge({ r }: { r: RoutingRecentRowDto }) {
  const tone = statusTone(r.status, r.ok)
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center gap-1 rounded-[6px] px-1.5 text-[11px] font-medium tabular-nums',
        tone.className,
      )}
    >
      <span className={cn('size-1.5 rounded-full', tone.dot)} aria-hidden />
      {r.status || 'ERR'}
    </span>
  )
}

/** Token 列：↓输入 ↑输出 + ⚡缓存（参考截图）。 */
function TokenCell({ r }: { r: RoutingRecentRowDto }) {
  const { t } = useTranslation('nav')
  const cacheTokens = (r.cacheReadTokens ?? 0) + (r.cacheWriteTokens ?? 0)
  const noTokens = (r.inputTokens ?? 0) === 0 && (r.outputTokens ?? 0) === 0 && cacheTokens === 0
  if (noTokens) return <span className="block text-right text-muted-foreground">—</span>
  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className="flex items-center gap-1.5 tabular-nums">
        <span className="text-emerald-600 dark:text-emerald-400">
          ↓{fmtTokens(r.inputTokens ?? 0)}
        </span>
        <span className="text-blue-600 dark:text-blue-400">↑{fmtTokens(r.outputTokens ?? 0)}</span>
      </span>
      {cacheTokens > 0 && (
        <span className="text-[10px] tabular-nums text-muted-foreground">
          ⚡{fmtTokens(cacheTokens)} {t('routingLog.recent.cache')}
        </span>
      )}
    </div>
  )
}
