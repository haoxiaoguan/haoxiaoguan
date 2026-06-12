import { useMemo, useState } from 'react'
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
import { RefreshCw } from 'lucide-react'
import { useThemeValue } from '@/hooks/use-theme'
import { cn } from '@/lib/utils'
import {
  useTrendSeries,
  useActivityHeatmapData,
  useUsageSummaryRange,
  type TrendDimension,
} from '../hooks/useTrendSeries'
import { formatMetricValue } from '../utils/trend-fill'
import type { TimeRange } from '../utils/time-range'
import { activityStats } from '../utils/activity-stats'
import { DateRangePicker } from '../components/DateRangePicker'
import { ActivityHeatmap } from './ActivityHeatmap'
import { VIZ } from './viz-colors'

interface TrendChartCardProps {
  range: TimeRange
  onRangeChange: (r: TimeRange) => void
  /** 自动刷新间隔（秒），0=关。控件在卡片右上，状态由页面持有（驱动定时器）。 */
  refreshInterval: number
  onRefreshIntervalChange: (v: number) => void
  refreshNonce?: number
}

const DIM_OPTIONS: { value: TrendDimension; labelKey: string }[] = [
  { value: 'activity',   labelKey: 'trend.dimActivity' },
  { value: 'tokens',     labelKey: 'trend.dimToken' },
  { value: 'cost',       labelKey: 'trend.dimCost' },
  { value: 'tool_calls', labelKey: 'trend.dimTool' },
  { value: 'sessions',   labelKey: 'trend.dimSession' },
  { value: 'code_lines', labelKey: 'trend.dimCode' },
]

/** 刷新间隔循环档位（秒）：点击按钮在档位间轮转。 */
const REFRESH_STEPS = [0, 5, 10, 30, 60]

// Themed custom tooltip -------------------------------------------------------
interface ChartTooltipProps {
  active?: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: ReadonlyArray<{ value?: number | string; payload?: any }>
  label?: string | number
  dimension: TrendDimension
}

function ChartTooltip({ active, payload, label, dimension }: ChartTooltipProps) {
  const { t } = useTranslation('dashboard')
  if (!active || !payload?.length) return null

  if (dimension === 'tokens') {
    const point = payload[0]?.payload as { value?: number; extra?: Record<string, number> } | undefined
    const total = typeof payload[0]?.value === 'number' ? payload[0].value : (point?.value ?? 0)
    const extra = point?.extra
    const rows: { labelKey: string; color: string; val: number }[] = [
      { labelKey: 'trend.tipInput',       color: VIZ.blue,   val: extra?.input ?? 0 },
      { labelKey: 'trend.tipOutput',      color: VIZ.green,  val: extra?.output ?? 0 },
      { labelKey: 'trend.tipCacheCreate', color: VIZ.amber,  val: extra?.cacheCreation ?? 0 },
      { labelKey: 'trend.tipCacheRead',   color: VIZ.violet, val: extra?.cacheRead ?? 0 },
    ]
    return (
      <div className="rounded-[8px] border border-border bg-card px-3 py-2 shadow-md min-w-[150px]">
        <p className="text-[11px] text-muted-foreground">{label}</p>
        <div className="mt-1 flex flex-col gap-0.5">
          {rows.map((row) => (
            <div key={row.labelKey} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <span className="size-1.5 rounded-full shrink-0" style={{ background: row.color }} />
                {t(row.labelKey)}
              </span>
              <span className="text-[11px] font-medium tabular-nums text-foreground">
                {row.val.toLocaleString('en-US')}
              </span>
            </div>
          ))}
          <div className="mt-1 flex items-center justify-between gap-3 border-t border-border pt-1">
            <span className="text-[11px] text-muted-foreground">{t('trend.tipTotal')}</span>
            <span className="text-[12px] font-semibold tabular-nums text-foreground">
              {(typeof total === 'number' ? total : 0).toLocaleString('en-US')}
            </span>
          </div>
        </div>
      </div>
    )
  }

  const val = payload[0]?.value
  const display =
    dimension === 'cost'
      ? formatMetricValue(typeof val === 'number' ? val : 0, 'cost')
      : typeof val === 'number'
        ? val.toLocaleString('en-US')
        : (val ?? '—')
  return (
    <div className="rounded-[8px] border border-border bg-card px-3 py-2 shadow-md">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-[13px] font-semibold tabular-nums text-foreground">
        {display}
      </p>
    </div>
  )
}

// Skeleton shimmer lines while loading ----------------------------------------
function LoadingPlaceholder() {
  return (
    <div className="flex h-full flex-col justify-end gap-[6px] px-1 pb-2" aria-hidden>
      {[0.55, 0.72, 0.38, 0.85, 0.6, 0.45, 0.9, 0.5].map((h, i) => (
        <div
          key={i}
          className="w-full animate-pulse rounded-sm bg-muted/60"
          style={{ height: `${h * 100}%`, opacity: 0.4 + h * 0.3 }}
        />
      ))}
    </div>
  )
}

// ── 统计行（图表下方，按维度变化）──────────────────────────────────────────────

interface StatItem {
  label: string
  value: string
}

function StatRow({ items }: { items: StatItem[] }) {
  return (
    <div className="flex shrink-0 items-stretch border-t border-border/70 px-4 py-2.5">
      {items.map((item, i) => (
        <div
          key={item.label}
          className={cn('pr-5', i > 0 && 'border-l border-border/70 pl-5')}
        >
          <p className="text-[11px] leading-4 text-muted-foreground">{item.label}</p>
          <p
            className="mt-0.5 text-[16px] font-semibold leading-5 tracking-tight text-foreground"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {item.value}
          </p>
        </div>
      ))}
    </div>
  )
}

/**
 * 趋势分析主卡（整行）：6 维度（活跃热力图 + 5 条数值曲线），
 * 右上内嵌「自动刷新档位」与「时间范围选择器」（活跃维度固定近一年，选择器置灰），
 * 图表下方为该维度的统计行。
 */
export function TrendChartCard({
  range,
  onRangeChange,
  refreshInterval,
  onRefreshIntervalChange,
  refreshNonce,
}: TrendChartCardProps) {
  const { t } = useTranslation('dashboard')
  const theme = useThemeValue()

  const [dimension, setDimension] = useState<TrendDimension>('activity')
  const isActivity = dimension === 'activity'

  const { points, total, loading } = useTrendSeries(range, dimension, !isActivity, refreshNonce)
  const heatmap = useActivityHeatmapData(isActivity, refreshNonce)
  const { summary } = useUsageSummaryRange(range, refreshNonce)

  // Theme-aware colors
  const brandBlue   = theme === 'dark' ? '#3b82f6' : '#2563eb'
  const gridColor   = theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.06)'
  const tickColor   = theme === 'dark' ? 'rgba(255,255,255,0.35)' : 'rgba(15,23,42,0.35)'
  const gradId      = `trend-area-grad-${theme}`

  // 最后同步时间（HH:mm）——来自范围汇总的 lastSyncedAt（Unix 秒）。
  const syncLabel = useMemo(() => {
    if (summary?.lastSyncedAt == null) return null
    const d = new Date(summary.lastSyncedAt * 1000)
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
  }, [summary?.lastSyncedAt])

  const cycleRefresh = () => {
    const idx = REFRESH_STEPS.indexOf(refreshInterval)
    onRefreshIntervalChange(REFRESH_STEPS[(idx + 1) % REFRESH_STEPS.length] ?? 0)
  }

  // 维度统计行
  const stats = useMemo<StatItem[]>(() => {
    if (isActivity) {
      const s = activityStats(heatmap.points, Date.now())
      return [
        { label: t('trend.stats.todaySessions'), value: s.todaySessions.toLocaleString('en-US') },
        { label: t('trend.stats.weekActiveDays'), value: t('trend.stats.days', { n: s.weekActiveDays }) },
        { label: t('trend.stats.monthActiveDays'), value: t('trend.stats.days', { n: s.monthActiveDays }) },
      ]
    }
    const days = Math.max(1, Math.round((range.endMs - range.startMs) / 86_400_000))
    if (dimension === 'tokens') {
      const input = summary?.inputTokens ?? 0
      const output = summary?.outputTokens ?? 0
      const cache = (summary?.cacheReadTokens ?? 0) + (summary?.cacheCreationTokens ?? 0)
      return [
        { label: t('trend.stats.total'), value: formatMetricValue(input + output + cache, 'tokens') },
        { label: t('trend.tipInput'), value: formatMetricValue(input, 'tokens') },
        { label: t('trend.tipOutput'), value: formatMetricValue(output, 'tokens') },
        { label: t('trend.stats.cache'), value: formatMetricValue(cache, 'tokens') },
        { label: t('trend.stats.requests'), value: (summary?.requests ?? 0).toLocaleString('en-US') },
      ]
    }
    if (dimension === 'cost') {
      const totalCost = summary?.totalCostUsd ?? 0
      const peak = points.reduce((m, p) => Math.max(m, p.value), 0)
      return [
        { label: t('trend.stats.total'), value: formatMetricValue(totalCost, 'cost') },
        { label: t('trend.stats.avgPerDay'), value: formatMetricValue(totalCost / days, 'cost') },
        { label: t('trend.stats.peak'), value: formatMetricValue(peak, 'cost') },
      ]
    }
    const peak = points.reduce((m, p) => Math.max(m, p.value), 0)
    return [
      { label: t('trend.stats.total'), value: total.toLocaleString('en-US') },
      { label: t('trend.stats.avgPerDay'), value: Math.round(total / days).toLocaleString('en-US') },
      { label: t('trend.stats.peak'), value: peak.toLocaleString('en-US') },
    ]
  }, [isActivity, heatmap.points, dimension, summary, points, total, range, t])

  return (
    <div className="flex h-full flex-col rounded-[14px] border border-border bg-card text-card-foreground shadow-bento-light dark:shadow-bento">
      {/* ── Header：标题 | 同步时间 · 刷新档位 · 时间范围 ─────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3.5">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {t('trend.title')}
        </span>
        <div className="flex items-center gap-2">
          {syncLabel != null && (
            <span
              className="flex items-center gap-1 text-[11px] tabular-nums text-muted-foreground"
              title={t('datawall.lastSynced')}
            >
              <RefreshCw className="size-3" strokeWidth={1.8} aria-hidden />
              {syncLabel}
            </span>
          )}
          <button
            type="button"
            onClick={cycleRefresh}
            title={t('datawall.autoRefresh')}
            className={cn(
              'flex h-8 items-center gap-1.5 rounded-[8px] border px-2.5 text-[12px] tabular-nums transition-colors',
              refreshInterval > 0
                ? 'border-primary/40 text-primary'
                : 'border-border text-muted-foreground hover:text-foreground',
            )}
            aria-label={t('datawall.autoRefresh')}
          >
            <RefreshCw className="size-3.5" strokeWidth={1.9} aria-hidden />
            {refreshInterval > 0 ? `${refreshInterval}s` : t('datawall.interval.off')}
          </button>
          <DateRangePicker value={range} onChange={onRangeChange} disabled={isActivity} />
        </div>
      </div>

      {/* ── Dimension segmented control ───────────────────────────── */}
      <div className="px-4 pt-2.5">
        <div
          className="inline-flex items-center gap-0.5 rounded-full bg-muted/60 p-[3px]"
          role="group"
          aria-label={t('trend.title')}
        >
          {DIM_OPTIONS.map(({ value, labelKey }) => (
            <button
              key={value}
              onClick={() => setDimension(value)}
              className={cn(
                'rounded-full px-3 py-1 text-[11.5px] transition-all duration-150',
                dimension === value
                  ? 'bg-card font-medium text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              aria-pressed={dimension === value}
            >
              {t(labelKey)}
            </button>
          ))}
        </div>
      </div>

      {/* ── 图区：活跃=热力图，数值=面积图 ─────────────────────────── */}
      {/* min-h 保底：极矮窗口下 recharts ResponsiveContainer 量出 ≤0 高会直接不渲染，
          保底 160px 让曲线任何情况下可见；正常时 flex-1 吃满剩余（高度链由页面 absolute 锚定保证）。 */}
      <div className="min-h-[160px] flex-1 px-4 pb-2 pt-2">
        {isActivity ? (
          heatmap.loading ? (
            <LoadingPlaceholder />
          ) : (
            <ActivityHeatmap points={heatmap.points} now={Date.now()} />
          )
        ) : loading ? (
          <LoadingPlaceholder />
        ) : points.length === 0 ? (
          <div className="flex h-full items-center justify-center text-[12px] text-muted-foreground">
            {t('trend.empty')}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor={brandBlue} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={brandBlue} stopOpacity={0} />
                </linearGradient>
              </defs>

              <CartesianGrid
                vertical={false}
                stroke={gridColor}
                strokeDasharray="0"
              />

              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tick={{ fill: tickColor, fontSize: 10, fontFamily: 'inherit' }}
                interval="preserveStartEnd"
                minTickGap={32}
              />

              <YAxis hide />

              <Tooltip
                content={(props) => (
                  <ChartTooltip
                    active={props.active}
                    payload={props.payload as ChartTooltipProps['payload']}
                    label={props.label}
                    dimension={dimension}
                  />
                )}
                cursor={{ stroke: brandBlue, strokeWidth: 1, strokeDasharray: '3 3' }}
              />

              <Area
                type="monotone"
                dataKey="value"
                stroke={brandBlue}
                strokeWidth={2.5}
                fill={`url(#${gradId})`}
                dot={false}
                activeDot={{ r: 3.5, fill: brandBlue, strokeWidth: 0 }}
                isAnimationActive={true}
                animationDuration={600}
                animationEasing="ease-out"
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── 维度统计行 ─────────────────────────────────────────────── */}
      <StatRow items={stats} />
    </div>
  )
}
