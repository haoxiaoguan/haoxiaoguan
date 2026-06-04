import { useTranslation } from 'react-i18next'
import type { PoolHealth } from '../utils/quota-health-summary'
import { DataWallCard } from './DataWallCard'
import { VIZ } from './viz-colors'

interface Props {
  pool: PoolHealth
  onRefresh: () => void
  refreshing?: boolean
}

/**
 * Pool health card — stacked bar showing available / cooldown / exhausted
 * proportions, with honest empty state when no data is present.
 */
export function PoolHealthCard({ pool, onRefresh, refreshing = false }: Props) {
  const { t } = useTranslation('dashboard')

  return (
    <DataWallCard title={t('pool.title')}>
      {pool.hasData ? (
        <FilledState pool={pool} />
      ) : (
        <EmptyState onRefresh={onRefresh} refreshing={refreshing} />
      )}
    </DataWallCard>
  )
}

// ── Filled ────────────────────────────────────────────────────────────────────

function FilledState({ pool }: { pool: PoolHealth }) {
  const { t } = useTranslation('dashboard')
  const { available, cooldown, exhausted, total } = pool

  // Guard against division by zero — total is guaranteed > 0 when hasData=true,
  // but be defensive.
  const safe = total > 0 ? total : 1
  const availablePct = (available / safe) * 100
  const cooldownPct  = (cooldown  / safe) * 100
  const exhaustedPct = (exhausted / safe) * 100

  return (
    <>
      {/* Large total + label */}
      <div className="flex items-baseline gap-1.5">
        <span
          className="text-[34px] font-extrabold leading-none tracking-tight text-foreground"
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {total}
        </span>
        <span className="text-[12px] text-muted-foreground">{t('pool.inPool')}</span>
      </div>

      {/* Horizontal stacked bar */}
      <div
        className="mt-3 flex h-[8px] w-full overflow-hidden rounded-full bg-muted/40"
        role="img"
        aria-label={`${t('pool.available')} ${available}, ${t('pool.cooldown')} ${cooldown}, ${t('pool.exhausted')} ${exhausted}`}
      >
        {availablePct > 0 && (
          <div
            className="h-full transition-all duration-500"
            style={{ width: `${availablePct}%`, background: VIZ.green }}
          />
        )}
        {cooldownPct > 0 && (
          <div
            className="h-full transition-all duration-500"
            style={{ width: `${cooldownPct}%`, background: VIZ.amber }}
          />
        )}
        {exhaustedPct > 0 && (
          <div
            className="h-full transition-all duration-500"
            style={{ width: `${exhaustedPct}%`, background: VIZ.red }}
          />
        )}
      </div>

      {/* Legend chips */}
      <div className="mt-2.5 flex gap-2">
        <LegendChip label={t('pool.available')} value={available} color={VIZ.green} />
        <LegendChip label={t('pool.cooldown')}  value={cooldown}  color={VIZ.amber} />
        <LegendChip label={t('pool.exhausted')} value={exhausted} color={VIZ.red}   />
      </div>
    </>
  )
}

function LegendChip({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex flex-1 items-center gap-1.5 rounded-[8px] border border-border bg-muted/40 px-2.5 py-1.5">
      <span className="size-1.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="ml-auto text-[13px] font-semibold tabular-nums text-foreground">{value}</span>
    </div>
  )
}

// ── Empty ─────────────────────────────────────────────────────────────────────

function EmptyState({ onRefresh, refreshing }: { onRefresh: () => void; refreshing: boolean }) {
  const { t } = useTranslation('dashboard')

  return (
    <div className="flex h-24 flex-col items-center justify-center gap-3">
      <span className="text-[12px] text-muted-foreground">{t('pool.empty')}</span>
      <button
        type="button"
        disabled={refreshing}
        onClick={onRefresh}
        className="rounded-[7px] border border-border bg-muted/40 px-3 py-1 text-[11px] font-medium text-foreground transition-opacity hover:opacity-75 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {refreshing ? t('actions.refreshing') : t('actions.refresh')}
      </button>
    </div>
  )
}
