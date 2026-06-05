import { useState } from 'react'
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
import { useThemeValue } from '@/hooks/use-theme'
import { useTrendSeries } from '../hooks/useTrendSeries'
import type { TrendRange, TrendDimension } from '../hooks/useTrendSeries'
import { formatMetricValue } from '../utils/trend-fill'
import { VIZ } from './viz-colors'
import { cn } from '@/lib/utils'

interface TrendChartCardProps {
  range: TrendRange
  onRangeChange: (r: TrendRange) => void
  refreshNonce?: number
}

const RANGE_OPTIONS: { value: TrendRange; labelKey: string }[] = [
  { value: '1d', labelKey: 'trend.rangeToday' },
  { value: '7d', labelKey: 'trend.rangeWeek' },
  { value: '30d', labelKey: 'trend.rangeMonth' },
]

const DIM_OPTIONS: { value: TrendDimension; labelKey: string }[] = [
  { value: 'tokens',     labelKey: 'trend.dimToken' },
  { value: 'tool_calls', labelKey: 'trend.dimTool' },
  { value: 'sessions',   labelKey: 'trend.dimSession' },
  { value: 'code_lines', labelKey: 'trend.dimCode' },
]

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
  return (
    <div className="rounded-[8px] border border-border bg-card px-3 py-2 shadow-md">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-[13px] font-semibold tabular-nums text-foreground">
        {typeof val === 'number' ? val.toLocaleString('en-US') : (val ?? '—')}
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

/**
 * Central trend chart card for the data wall.
 * Controlled `range` prop; internal `dimension` state.
 * Optional `refreshNonce` — increment externally to force a data re-fetch.
 */
export function TrendChartCard({ range, onRangeChange, refreshNonce }: TrendChartCardProps) {
  const { t } = useTranslation('dashboard')
  const theme = useThemeValue()

  const [dimension, setDimension] = useState<TrendDimension>('tokens')
  const { points, total, loading } = useTrendSeries(range, dimension, refreshNonce)

  // Theme-aware colors
  const brandBlue   = theme === 'dark' ? '#3b82f6' : '#2563eb'
  const gridColor   = theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.06)'
  const tickColor   = theme === 'dark' ? 'rgba(255,255,255,0.35)' : 'rgba(15,23,42,0.35)'
  const gradId      = `trend-area-grad-${theme}`

  const valueKind = dimension === 'tokens' ? 'tokens' : 'count'
  const totalLabel = formatMetricValue(total, valueKind)

  return (
    <div className="flex h-full flex-col rounded-[14px] border border-border bg-card text-card-foreground shadow-bento-light dark:shadow-bento">
      {/* ── Header row ────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-2 px-4 pt-4">
        {/* Left: title + big number */}
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t('trend.title')}
          </span>
          <span
            className="text-[28px] font-extrabold leading-none tracking-tight text-foreground"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {loading ? (
              <span className="inline-block w-20 animate-pulse rounded bg-muted/60 align-middle">&nbsp;</span>
            ) : (
              totalLabel
            )}
          </span>
        </div>

        {/* Right: range pills */}
        <div
          className="flex items-center gap-1 rounded-full bg-muted/50 p-[3px]"
          role="group"
          aria-label={t('trend.title')}
        >
          {RANGE_OPTIONS.map(({ value, labelKey }) => (
            <button
              key={value}
              onClick={() => onRangeChange(value)}
              className={cn(
                'rounded-full px-3 py-1 text-[11px] font-medium transition-all duration-150',
                range === value
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              aria-pressed={range === value}
            >
              {t(labelKey)}
            </button>
          ))}
        </div>
      </div>

      {/* ── Dimension pills row ───────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-1.5 px-4 pt-2.5">
        {DIM_OPTIONS.map(({ value, labelKey }) => (
          <button
            key={value}
            onClick={() => setDimension(value)}
            className={cn(
              'rounded-md px-2.5 py-1 text-[11px] font-medium transition-all duration-150',
              dimension === value
                ? 'bg-[#2563eb] text-white dark:bg-[#3b82f6]'
                : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
            aria-pressed={dimension === value}
          >
            {t(labelKey)}
          </button>
        ))}
      </div>

      {/* ── Chart area ────────────────────────────────────────────── */}
      <div className="min-h-0 flex-1 px-2 pb-3 pt-2">
        {loading ? (
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
    </div>
  )
}
