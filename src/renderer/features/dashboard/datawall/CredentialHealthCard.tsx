import { useTranslation } from 'react-i18next'
import type { CredentialHealth } from '../utils/quota-health-summary'
import { DataWallCard } from './DataWallCard'
import { VIZ } from './viz-colors'

interface Props {
  credential: CredentialHealth
  onRefresh: () => void
  refreshing?: boolean
}

/**
 * Credential health card — large valid count, three equal-width metric cells,
 * with honest empty state when no data is present.
 */
export function CredentialHealthCard({ credential, onRefresh, refreshing = false }: Props) {
  const { t } = useTranslation('dashboard')

  return (
    <DataWallCard title={t('credential.title')}>
      {credential.hasData ? (
        <FilledState credential={credential} />
      ) : (
        <EmptyState onRefresh={onRefresh} refreshing={refreshing} />
      )}
    </DataWallCard>
  )
}

// ── Filled ────────────────────────────────────────────────────────────────────

function FilledState({ credential }: { credential: CredentialHealth }) {
  const { t } = useTranslation('dashboard')
  const { valid, expiring, invalid, total } = credential

  return (
    <>
      {/* Large valid count + fraction label */}
      <div className="flex items-baseline gap-1.5">
        <span
          className="text-[34px] font-extrabold leading-none tracking-tight"
          style={{ color: VIZ.green, fontVariantNumeric: 'tabular-nums' }}
        >
          {valid}
        </span>
        <span className="text-[12px] text-muted-foreground">
          / {total} {t('credential.validOf')}
        </span>
      </div>

      {/* Three equal-width cells */}
      <div className="mt-3 flex gap-2">
        <MetricCell label={t('credential.valid')}    value={valid}    color={VIZ.green} />
        <MetricCell label={t('credential.expiring')} value={expiring} color={VIZ.amber} />
        <MetricCell label={t('credential.invalid')}  value={invalid}  color={VIZ.red}   />
      </div>
    </>
  )
}

function MetricCell({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex flex-1 flex-col items-center gap-0.5 rounded-[8px] border border-border bg-muted/40 py-2">
      <span
        className="text-[20px] font-bold leading-none tabular-nums"
        style={{ color }}
      >
        {value}
      </span>
      <span className="text-[10px] text-muted-foreground">{label}</span>
    </div>
  )
}

// ── Empty ─────────────────────────────────────────────────────────────────────

function EmptyState({ onRefresh, refreshing }: { onRefresh: () => void; refreshing: boolean }) {
  const { t } = useTranslation('dashboard')

  return (
    <div className="flex h-24 flex-col items-center justify-center gap-3">
      <span className="text-[12px] text-muted-foreground">{t('credential.empty')}</span>
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
