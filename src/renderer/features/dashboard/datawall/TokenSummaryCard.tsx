import { useTranslation } from 'react-i18next'
import { formatMetricValue } from '../utils/trend-fill'
import { DataWallCard } from './DataWallCard'
import { VIZ } from './viz-colors'

interface Props {
  rangeLabel: string
  totalTokens: number
  inputTokens: number
  outputTokens: number
  cacheTokens: number
  requests: number
}

interface BarDef {
  labelKey: string
  value: number
  color: string
}

/**
 * Token summary card — shows total tokens for a period with
 * three proportion bars (input / output / cache).
 */
export function TokenSummaryCard({
  rangeLabel,
  totalTokens,
  inputTokens,
  outputTokens,
  cacheTokens,
  requests,
}: Props) {
  const { t } = useTranslation('dashboard')

  const bars: BarDef[] = [
    { labelKey: 'token.in',    value: inputTokens,  color: VIZ.blue  },
    { labelKey: 'token.out',   value: outputTokens, color: VIZ.green },
    { labelKey: 'token.cache', value: cacheTokens,  color: VIZ.amber },
  ]

  const maxVal = Math.max(inputTokens, outputTokens, cacheTokens, 1)

  return (
    <DataWallCard
      title={t('token.title', { range: rangeLabel })}
      headerRight={
        <span className="flex items-baseline gap-1 text-[10px] text-muted-foreground">
          <span className="font-semibold tabular-nums text-foreground">
            {requests.toLocaleString('en-US')}
          </span>
          {t('token.requests')}
        </span>
      }
    >
      {/* Large total */}
      <div
        className="text-[34px] font-extrabold leading-none tracking-tight text-foreground"
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {formatMetricValue(totalTokens, 'tokens')}
      </div>

      {/* Proportion bars */}
      <div className="mt-4 flex items-end gap-2" style={{ height: 40 }}>
        {bars.map((bar) => {
          const heightPct = maxVal > 0 ? (bar.value / maxVal) * 100 : 0
          return (
            <div
              key={bar.labelKey}
              className="flex flex-1 flex-col items-center justify-end gap-1"
              style={{ height: 40 }}
            >
              <div
                className="w-full rounded-t-[3px] transition-all duration-500"
                style={{
                  height: `${Math.max(heightPct, 4)}%`,
                  background: bar.color,
                  opacity: 0.85,
                }}
                aria-label={`${t(bar.labelKey)}: ${formatMetricValue(bar.value, 'tokens')}`}
              />
            </div>
          )
        })}
      </div>

      {/* Detail line */}
      <div className="mt-2 flex flex-wrap gap-x-2 gap-y-0.5">
        {bars.map((bar) => (
          <span key={bar.labelKey} className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <span className="size-1.5 rounded-full" style={{ background: bar.color }} aria-hidden />
            {t(bar.labelKey)}&nbsp;
            <span className="font-medium tabular-nums text-foreground">
              {formatMetricValue(bar.value, 'tokens')}
            </span>
          </span>
        ))}
      </div>
    </DataWallCard>
  )
}
