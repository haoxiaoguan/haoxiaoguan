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
  ChevronLeft,
  ChevronRight,
  Download,
  RefreshCw,
  Radio,
  Route as RouteIcon,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { useRoutingObsStore } from '../stores/routingObsStore'
import { RoutingDetailDrawer } from '../components/routing-log/RoutingDetailDrawer'
import { bridge } from '../services/bridge'
import type { RoutingObsBreakdownDimDto, RoutingObsEventDto, RoutingObsSearchFilterDto } from '@shared/api-types'
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
import { presetRange, granularityFor, toWindow, type TimeRange } from '../features/dashboard/utils/time-range'

// ── formatters ────────────────────────────────────────────────────────────────

const fmtInt = (n: number) => n.toLocaleString('en-US')
const fmtPct = (r: number) => `${(r * 100).toFixed(1)}%`
const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`)
const fmtTokens = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
const fmtRpm = (n: number) => (n >= 10 ? fmtInt(Math.round(n)) : n.toFixed(1))
const p2 = (n: number) => String(n).padStart(2, '0')
const fmtDateTime = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}/${p2(d.getMonth() + 1)}/${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`
}
const shortLabel = (date: string) => (date.length >= 5 ? date.slice(5) : date)

const DIMENSIONS: RoutingObsBreakdownDimDto[] = ['platform', 'combo', 'model', 'status', 'account', 'clientKey']
const DIM_LABEL: Record<RoutingObsBreakdownDimDto, string> = {
  platform: '平台',
  combo: '组合',
  model: '模型',
  status: '状态',
  account: '账号',
  clientKey: '客户端Key',
}

const RECENT_FILTERS = ['all', 'ok', 'failed'] as const
type RecentFilterMode = (typeof RECENT_FILTERS)[number]

/** 最近请求列表每页条数。 */
const PAGE_SIZE = 10

/** 维度下钻的 key → 检索过滤字段映射（点下钻行注入过滤）。 */
function filterFromBreakdown(
  dim: RoutingObsBreakdownDimDto,
  key: string,
): Partial<RoutingObsSearchFilterDto> {
  switch (dim) {
    case 'platform':
      return { platform: key }
    case 'combo':
      return { comboName: key }
    case 'model':
      return { model: key }
    case 'account':
      return { accountId: key }
    case 'clientKey':
      return { clientKeyId: key }
    case 'status':
      return { statusClass: key as RoutingObsSearchFilterDto['statusClass'] }
  }
}

/** 把已加载行导出为 CSV 下载。 */
function exportCsv(rows: RoutingObsEventDto[]): void {
  const headers = [
    'seq', 'time', 'status', 'ok', 'errorKind', 'platform', 'combo', 'requestedModel',
    'finalModel', 'account', 'clientKey', 'path', 'stream', 'durationMs', 'ttfbMs',
    'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'errorMessage',
  ]
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [
    headers.join(','),
    ...rows.map((r) =>
      [
        r.seq, fmtDateTime(r.tsMs), r.status, r.ok ? 1 : 0, r.errorKind, r.platform ?? '',
        r.comboName ?? '', r.requestedModel ?? '', r.finalModel ?? '', r.accountId ?? '',
        r.clientKeyId ?? '', r.path, r.stream ? 1 : 0, r.durationMs, r.ttfbMs ?? '',
        r.inputTokens ?? '', r.outputTokens ?? '', r.cacheReadTokens ?? '', r.cacheWriteTokens ?? '',
        r.errorMessage ?? '',
      ]
        .map(esc)
        .join(','),
    ),
  ]
  const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `routing-log-${Date.now()}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

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
      <p className={cn('mt-1 text-[20px] font-semibold leading-6 tabular-nums', valueColor)}>{value}</p>
      {sub != null && <p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">{sub}</p>}
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
  if (!active || !payload?.length) return null
  const p = payload[0]?.payload as
    | { success?: number; failed?: number; avgDurationMs?: number }
    | undefined
  if (!p) return null
  const rows = [
    { label: '成功', color: VIZ.green, val: fmtInt(p.success ?? 0) },
    { label: '失败', color: VIZ.red, val: fmtInt(p.failed ?? 0) },
    { label: '平均延迟', color: VIZ.gray, val: fmtMs(p.avgDurationMs ?? 0) },
  ]
  return (
    <div className="min-w-[140px] rounded-[8px] border border-border bg-card px-3 py-2 shadow-md">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <div className="mt-1 flex flex-col gap-0.5">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <span className="size-1.5 shrink-0 rounded-full" style={{ background: row.color }} />
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
    rows,
    hasMore,
    searching,
    detail,
    live,
    error,
    fetchOverview,
    fetchBreakdown,
    searchFirst,
    searchMore,
    openDetail,
    closeDetail,
    setLive,
    pushLive,
    clear,
  } = useRoutingObsStore()

  const [range, setRange] = useState<TimeRange>(() => presetRange('7d', Date.now()))
  const [dimension, setDimension] = useState<RoutingObsBreakdownDimDto>('platform')
  const [statusMode, setStatusMode] = useState<RecentFilterMode>('all')
  const [keyword, setKeyword] = useState('')
  const [keywordInput, setKeywordInput] = useState('')
  const [activeFilter, setActiveFilter] = useState<{ dim: RoutingObsBreakdownDimDto; key: string } | null>(null)
  const [nonce, setNonce] = useState(0)
  const [pageIndex, setPageIndex] = useState(0)

  // 检索过滤：状态 + 关键字 + 维度下钻注入的过滤。
  const filter = useMemo<RoutingObsSearchFilterDto>(() => {
    const f: RoutingObsSearchFilterDto = {}
    if (statusMode === 'ok') f.okOnly = true
    if (statusMode === 'failed') f.failedOnly = true
    if (keyword.trim() !== '') f.keyword = keyword.trim()
    if (activeFilter) Object.assign(f, filterFromBreakdown(activeFilter.dim, activeFilter.key))
    return f
  }, [statusMode, keyword, activeFilter])

  // 关键字输入 debounce → keyword。
  useEffect(() => {
    const id = setTimeout(() => setKeyword(keywordInput), 350)
    return () => clearTimeout(id)
  }, [keywordInput])

  // 范围 / 手动刷新 → 概览 + 下钻。
  useEffect(() => {
    const window = toWindow(range)
    void fetchOverview(window, granularityFor(range))
    void fetchBreakdown(window, dimension)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, nonce])

  useEffect(() => {
    void fetchBreakdown(toWindow(range), dimension)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dimension])

  // 范围 / 过滤 / 刷新 → 检索首页 + 回到第一页（实时模式下不重置，由 onEvent 注入）。
  useEffect(() => {
    setPageIndex(0)
    if (live) return
    void searchFirst(toWindow(range), filter)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, filter, nonce, live])

  // rows 收缩（重新检索 / 清空 / 实时截断）时把页码夹在有效范围内。
  useEffect(() => {
    const maxPage = Math.max(0, Math.ceil(rows.length / PAGE_SIZE) - 1)
    setPageIndex((p) => (p > maxPage ? maxPage : p))
  }, [rows.length])

  // 实时模式：订阅 onEvent 把新批次注入列表头部。
  useEffect(() => {
    if (!live) return
    const unsub = bridge().routingObs.onEvent((batch) => pushLive(batch))
    return unsub
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live])

  useEffect(() => {
    if (error) toast.error(error)
  }, [error])

  const gridColor = theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.06)'
  const tickColor = theme === 'dark' ? 'rgba(255,255,255,0.35)' : 'rgba(15,23,42,0.35)'
  const trendData = useMemo(() => trend.map((p) => ({ ...p, label: shortLabel(p.date) })), [trend])

  const avgRpm = useMemo(() => {
    if (summary == null || summary.requests === 0) return 0
    const w = toWindow(range)
    const minutes = Math.max(1, (w.endSec - w.startSec) / 60)
    return summary.requests / minutes
  }, [summary, range])

  // 最近请求分页（每页 PAGE_SIZE 条）：本地切片；翻到已加载末页且后端仍有更多时按需续拉。
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const pageRows = useMemo(
    () => rows.slice(pageIndex * PAGE_SIZE, pageIndex * PAGE_SIZE + PAGE_SIZE),
    [rows, pageIndex],
  )
  const canPrev = pageIndex > 0
  const canNext = pageIndex < totalPages - 1 || (!live && hasMore)
  const totalLabel = `${rows.length}${!live && hasMore ? '+' : ''}`

  const goPrev = () => setPageIndex((p) => Math.max(0, p - 1))
  const goNext = async () => {
    if (pageIndex < totalPages - 1) {
      setPageIndex((p) => p + 1)
      return
    }
    // 已到已加载末页：后端仍有更多则续拉一批再前进。
    if (!live && hasMore && !searching) {
      await searchMore(toWindow(range), filter)
      setPageIndex((p) => p + 1)
    }
  }

  const columns = useMemo<ColumnDef<RoutingObsEventDto>[]>(
    () => [
      {
        id: 'key',
        size: 110,
        header: () => t('routingLog.recent.colKey', { defaultValue: '密钥' }),
        cell: ({ row }) => (
          <span
            className="block max-w-[100px] truncate font-mono text-[11px] text-muted-foreground"
            title={row.original.clientKeyId ?? ''}
          >
            {row.original.clientKeyId ?? t('routingLog.recent.anon', { defaultValue: '匿名' })}
          </span>
        ),
      },
      {
        id: 'model',
        size: 210,
        header: () => t('routingLog.recent.colModel', { defaultValue: '模型' }),
        cell: ({ row }) => <ModelCell r={row.original} />,
      },
      {
        id: 'route',
        size: 150,
        header: () => t('routingLog.recent.colRoute', { defaultValue: '路由' }),
        cell: ({ row }) => <RouteCell r={row.original} />,
      },
      {
        id: 'type',
        size: 70,
        header: () => t('routingLog.recent.colType', { defaultValue: '类型' }),
        cell: ({ row }) =>
          row.original.stream ? (
            <span className="rounded-[4px] bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 dark:text-blue-400">
              {t('routingLog.recent.typeStream', { defaultValue: '流式' })}
            </span>
          ) : (
            <span className="text-[11px] text-muted-foreground">
              {t('routingLog.recent.typeSync', { defaultValue: '同步' })}
            </span>
          ),
      },
      {
        id: 'status',
        size: 92,
        header: () => t('routingLog.recent.colStatus', { defaultValue: '状态' }),
        cell: ({ row }) => <StatusBadge r={row.original} />,
      },
      {
        id: 'tokens',
        size: 140,
        header: () => <span className="block text-right">{t('routingLog.recent.colTokens', { defaultValue: 'Token' })}</span>,
        cell: ({ row }) => <TokenCell r={row.original} />,
      },
      {
        id: 'duration',
        size: 100,
        header: () => <span className="block text-right">{t('routingLog.recent.colLatency', { defaultValue: '耗时' })}</span>,
        cell: ({ row }) => (
          <span className="block text-right tabular-nums text-muted-foreground">
            {fmtMs(row.original.durationMs)}
            {row.original.ttfbMs != null && (
              <span className="ml-1 text-[10px] opacity-70">首{fmtMs(row.original.ttfbMs)}</span>
            )}
          </span>
        ),
      },
      {
        id: 'time',
        size: 160,
        header: () => t('routingLog.recent.colTime', { defaultValue: '时间' }),
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums text-muted-foreground">
            {fmtDateTime(row.original.tsMs)}
          </span>
        ),
      },
      {
        id: 'action',
        size: 56,
        header: () => '',
        cell: ({ row }) => (
          <button
            onClick={() => openDetail(row.original)}
            className="rounded-[5px] px-1.5 py-0.5 text-[11px] text-primary hover:bg-primary/10"
          >
            {t('routingLog.recent.detail', { defaultValue: '详情' })}
          </button>
        ),
      },
    ],
    [t, openDetail],
  )

  const handleClear = async () => {
    await clear()
    toast.success(t('routingLog.cleared', { defaultValue: '已清空' }))
    setNonce((n) => n + 1)
  }

  const toggleLive = () => {
    const next = !live
    setLive(next)
    if (!next) {
      // 关闭实时 → 回到按窗口/过滤的静态检索。
      void searchFirst(toWindow(range), filter)
    }
  }

  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      {/* ── header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-[9px] bg-primary/10">
          <BarChart3 className="size-4.5 text-primary" strokeWidth={1.85} aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold leading-5 text-foreground">
            {t('routingLog.title', { defaultValue: '路由日志' })}
          </div>
          <div className="mt-0.5 text-[12px] text-muted-foreground">
            {t('routingLog.subtitle', { defaultValue: '反代请求的持久化日志与多维分析' })}
          </div>
        </div>
        <DateRangePicker value={range} onChange={setRange} />
        <Button
          variant={live ? 'default' : 'outline'}
          size="sm"
          className="h-8 gap-1.5"
          onClick={toggleLive}
        >
          <Radio className={cn('size-3.5', live && 'animate-pulse')} aria-hidden />
          {live ? t('routingLog.liveOn', { defaultValue: '实时中' }) : t('routingLog.live', { defaultValue: '实时' })}
        </Button>
        <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => setNonce((n) => n + 1)}>
          <RefreshCw className="size-3.5" aria-hidden />
          {t('routingLog.refresh', { defaultValue: '刷新' })}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5"
          disabled={rows.length === 0}
          onClick={() => exportCsv(rows)}
        >
          <Download className="size-3.5" aria-hidden />
          {t('routingLog.export', { defaultValue: '导出' })}
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-muted-foreground">
              <Trash2 className="size-3.5" aria-hidden />
              {t('routingLog.clear', { defaultValue: '清空' })}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('routingLog.clearTitle', { defaultValue: '清空路由日志？' })}</AlertDialogTitle>
              <AlertDialogDescription>
                {t('routingLog.clearDesc', { defaultValue: '将删除全部明细与日桶聚合，不可恢复。' })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('routingLog.cancel', { defaultValue: '取消' })}</AlertDialogCancel>
              <AlertDialogAction onClick={() => void handleClear()}>
                {t('routingLog.confirmClear', { defaultValue: '确认清空' })}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {/* ── KPI strip ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
        <KpiCard label={t('routingLog.kpi.requests', { defaultValue: '总请求' })} value={fmtInt(summary?.requests ?? 0)} />
        <KpiCard
          label={t('routingLog.kpi.rpm', { defaultValue: '峰值 RPM' })}
          value={fmtInt(summary?.peakRpm ?? 0)}
          sub={t('routingLog.kpi.rpmAvg', { defaultValue: `平均 ${fmtRpm(avgRpm)}/min`, avg: fmtRpm(avgRpm) })}
        />
        <KpiCard
          label={t('routingLog.kpi.successRate', { defaultValue: '成功率' })}
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
          sub={t('routingLog.kpi.failedCount', { defaultValue: `失败 ${summary?.failed ?? 0} 次`, count: summary?.failed ?? 0 })}
        />
        <KpiCard
          label={t('routingLog.kpi.avgLatency', { defaultValue: '平均延迟' })}
          value={fmtMs(summary?.avgDurationMs ?? 0)}
          sub={`P95 ${fmtMs(summary?.p95DurationMs ?? 0)} · 首字节 ${fmtMs(summary?.avgTtfbMs ?? 0)}`}
        />
        <KpiCard
          label={t('routingLog.kpi.tokens', { defaultValue: 'Token (入/出)' })}
          value={fmtTokens(summary?.totalTokens ?? 0)}
          sub={`↓${fmtTokens(summary?.inputTokens ?? 0)} ↑${fmtTokens(summary?.outputTokens ?? 0)} ⚡${fmtTokens(
            (summary?.cacheReadTokens ?? 0) + (summary?.cacheWriteTokens ?? 0),
          )}`}
        />
        <KpiCard
          label={t('routingLog.kpi.fallback', { defaultValue: '发生降级' })}
          value={fmtInt(summary?.fallbackRequests ?? 0)}
          sub={t('routingLog.kpi.fallbackSub', { defaultValue: '降级链触达 ≥2 跳' })}
        />
        <KpiCard
          label={t('routingLog.kpi.combo', { defaultValue: '命中组合' })}
          value={fmtInt(summary?.comboRequests ?? 0)}
          sub={t('routingLog.kpi.comboSub', { defaultValue: '经路由组合' })}
        />
      </div>

      {/* ── trend ───────────────────────────────────────────────────────── */}
      <div className="rounded-[14px] border border-border bg-card">
        <div className="flex items-center justify-between px-4 pt-3.5">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t('routingLog.trend.title', { defaultValue: '请求趋势' })}
          </span>
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="size-1.5 rounded-full" style={{ background: VIZ.green }} />
              {t('routingLog.trend.success', { defaultValue: '成功' })}
            </span>
            <span className="flex items-center gap-1">
              <span className="size-1.5 rounded-full" style={{ background: VIZ.red }} />
              {t('routingLog.trend.failed', { defaultValue: '失败' })}
            </span>
          </div>
        </div>
        <div className="h-[220px] px-2 pb-2 pt-3">
          {trendData.length === 0 ? (
            <div className="flex h-full items-center justify-center text-[12px] text-muted-foreground">
              {t('routingLog.empty', { defaultValue: '暂无数据' })}
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
                <Area type="monotone" dataKey="success" stackId="1" stroke={VIZ.green} strokeWidth={2} fill="url(#rl-ok)" isAnimationActive={false} />
                <Area type="monotone" dataKey="failed" stackId="1" stroke={VIZ.red} strokeWidth={2} fill="url(#rl-fail)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* ── breakdown + errors ──────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-[14px] border border-border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3.5">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t('routingLog.breakdown.title', { defaultValue: '维度下钻' })}
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
                  {t(`routingLog.dim.${dim}`, { defaultValue: DIM_LABEL[dim] })}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1.5 px-4 py-3.5">
            {breakdown.length === 0 ? (
              <div className="py-8 text-center text-[12px] text-muted-foreground">
                {t('routingLog.empty', { defaultValue: '暂无数据' })}
              </div>
            ) : (
              breakdown.slice(0, 10).map((row) => (
                <button
                  key={row.key}
                  onClick={() => setActiveFilter({ dim: dimension, key: row.key })}
                  className="flex flex-col gap-1 rounded-[6px] px-1 py-0.5 text-left hover:bg-muted/40"
                  title={t('routingLog.breakdown.filterBy', { defaultValue: '点击按此项过滤明细' })}
                >
                  <div className="flex items-center justify-between gap-2 text-[12px]">
                    <span className="truncate font-medium text-foreground">{row.key}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {fmtInt(row.requests)} · {fmtPct(row.successRate)} · {fmtMs(row.avgDurationMs)}
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(2, row.shareRatio * 100)}%` }} />
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="rounded-[14px] border border-border bg-card">
          <div className="flex items-center gap-1.5 px-4 pt-3.5">
            <AlertTriangle className="size-3.5 text-amber-500" strokeWidth={1.9} aria-hidden />
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t('routingLog.errors.title', { defaultValue: 'TOP 错误' })}
            </span>
          </div>
          <div className="flex flex-col gap-1 px-4 py-3.5">
            {errors.length === 0 ? (
              <div className="py-8 text-center text-[12px] text-muted-foreground">
                {t('routingLog.errors.empty', { defaultValue: '暂无错误' })}
              </div>
            ) : (
              errors.slice(0, 8).map((e, i) => (
                <div key={`${e.errorKind}-${e.message}-${i}`} className="flex items-center justify-between gap-2 rounded-[8px] px-2 py-1.5 hover:bg-muted/40">
                  <span className="min-w-0 flex-1 truncate text-[12px] text-foreground" title={e.message}>
                    <span className="mr-1.5 inline-block rounded-[5px] bg-rose-500/10 px-1 text-[10px] font-medium tabular-nums text-rose-600 dark:text-rose-400">
                      {e.errorKind}
                    </span>
                    {e.message || `HTTP ${e.lastStatus}`}
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

      {/* ── recent / search ─────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Activity className="size-3.5 text-primary" strokeWidth={1.9} aria-hidden />
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t('routingLog.recent.title', { defaultValue: '最近请求' })}
            </span>
            {live && (
              <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
                {t('routingLog.liveTail', { defaultValue: '实时' })}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <input
                value={keywordInput}
                onChange={(e) => setKeywordInput(e.target.value)}
                placeholder={t('routingLog.searchPlaceholder', { defaultValue: '搜索端点/模型/错误…' })}
                className="h-8 w-52 rounded-[8px] border border-border bg-card pl-7 pr-2 text-[12px] outline-none focus:border-primary/60"
              />
            </div>
            <div className="inline-flex items-center gap-0.5 rounded-full bg-muted/60 p-[3px]">
              {RECENT_FILTERS.map((m) => (
                <button
                  key={m}
                  onClick={() => setStatusMode(m)}
                  className={cn(
                    'rounded-full px-2.5 py-1 text-[11px] transition-all',
                    statusMode === m
                      ? 'bg-card font-medium text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                  aria-pressed={statusMode === m}
                >
                  {t(`routingLog.recent.filter.${m}`, { defaultValue: m === 'all' ? '全部' : m === 'ok' ? '成功' : '失败' })}
                </button>
              ))}
            </div>
          </div>
        </div>

        {activeFilter && (
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
              {DIM_LABEL[activeFilter.dim]}: {activeFilter.key}
              <button onClick={() => setActiveFilter(null)} className="hover:text-primary/70" aria-label="清除过滤">
                <X className="size-3" />
              </button>
            </span>
          </div>
        )}

        <DataTable
          columns={columns}
          data={pageRows}
          getRowId={(r) => `${r.seq}-${r.tsMs}`}
          tableClassName="min-w-[1040px]"
          rowProps={(row) => ({ onDoubleClick: () => openDetail(row.original), className: 'cursor-pointer' })}
          emptyState={
            <div className="py-10 text-center text-[12px] text-muted-foreground">
              {t('routingLog.recent.empty', { defaultValue: '暂无请求' })}
            </div>
          }
        />

        {rows.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 py-1 text-[12px] text-muted-foreground">
            <span className="tabular-nums">
              {t('routingLog.recent.totalCount', {
                value: totalLabel,
                defaultValue: `共 ${totalLabel} 条`,
              })}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 px-2"
                disabled={!canPrev}
                onClick={goPrev}
              >
                <ChevronLeft className="size-3.5" aria-hidden />
                {t('routingLog.recent.prevPage', { defaultValue: '上一页' })}
              </Button>
              <span className="tabular-nums">
                {t('routingLog.recent.pageInfo', {
                  current: pageIndex + 1,
                  total: totalPages,
                  defaultValue: `第 ${pageIndex + 1} / ${totalPages} 页`,
                })}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 px-2"
                disabled={!canNext || searching}
                onClick={() => void goNext()}
              >
                {t('routingLog.recent.nextPage', { defaultValue: '下一页' })}
                <ChevronRight className="size-3.5" aria-hidden />
              </Button>
            </div>
          </div>
        )}
      </div>

      <RoutingDetailDrawer row={detail} onClose={closeDetail} />
    </div>
  )
}

// ── recent cells ──────────────────────────────────────────────────────────────

/** 模型列：最终模型 + 降级跳数徽章（悬浮显示完整降级链）。 */
function ModelCell({ r }: { r: RoutingObsEventDto }) {
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
                  {t('routingLog.recent.fallbackPath', { defaultValue: '降级链路径' })}
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
function RouteCell({ r }: { r: RoutingObsEventDto }) {
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
function StatusBadge({ r }: { r: RoutingObsEventDto }) {
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

/** Token 列：↓输入 ↑输出 + ⚡缓存。 */
function TokenCell({ r }: { r: RoutingObsEventDto }) {
  const { t } = useTranslation('nav')
  const cacheTokens = (r.cacheReadTokens ?? 0) + (r.cacheWriteTokens ?? 0)
  const noTokens = (r.inputTokens ?? 0) === 0 && (r.outputTokens ?? 0) === 0 && cacheTokens === 0
  if (noTokens) return <span className="block text-right text-muted-foreground">—</span>
  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className="flex items-center gap-1.5 tabular-nums">
        <span className="text-emerald-600 dark:text-emerald-400">↓{fmtTokens(r.inputTokens ?? 0)}</span>
        <span className="text-blue-600 dark:text-blue-400">↑{fmtTokens(r.outputTokens ?? 0)}</span>
      </span>
      {cacheTokens > 0 && (
        <span className="text-[10px] tabular-nums text-muted-foreground">
          ⚡{fmtTokens(cacheTokens)} {t('routingLog.recent.cache', { defaultValue: '缓存' })}
        </span>
      )}
    </div>
  )
}
