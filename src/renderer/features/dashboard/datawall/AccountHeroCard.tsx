import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type { AccountStats } from '../utils/account-stats'
import { DataWallCard } from './DataWallCard'
import { VIZ } from './viz-colors'

type Props = Pick<AccountStats, 'total' | 'platformsCovered' | 'platformsTotal' | 'todayActive' | 'weekNew'>

/**
 * Account hero card — conic-gradient ring showing platform coverage,
 * large total count, and two sub-stat chips.
 */
export function AccountHeroCard({ total, platformsCovered, platformsTotal, todayActive, weekNew }: Props) {
  const { t } = useTranslation('dashboard')

  // Clamp to avoid invalid conic-gradient when platformsTotal === 0
  const coveragePct = platformsTotal > 0 ? Math.round((platformsCovered / platformsTotal) * 100) : 0

  // Build conic-gradient: covered = blue, remaining = muted ring track
  const ringGradient = `conic-gradient(${VIZ.blue} 0% ${coveragePct}%, #e2e8f0 ${coveragePct}% 100%)`

  return (
    <DataWallCard title={t('account.title')}>
      <div className="flex items-center gap-4">
        {/* Conic ring */}
        <div className="relative shrink-0" style={{ width: 72, height: 72 }}>
          {/* Outer ring */}
          <div
            className="absolute inset-0 rounded-full"
            style={{ background: ringGradient }}
            aria-hidden
          />
          {/* Inner cutout */}
          <div
            className="absolute rounded-full bg-card"
            style={{ inset: 10 }}
            aria-hidden
          />
          {/* Center label */}
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[10px] font-semibold leading-none text-foreground">
              {platformsCovered}
              <span className="text-muted-foreground">/{platformsTotal}</span>
            </span>
            <span className="mt-0.5 text-[9px] text-muted-foreground">
              {t('account.platforms')}
            </span>
          </div>
        </div>

        {/* Right: total */}
        <div className="flex flex-col">
          <span
            className="text-[34px] font-extrabold leading-none tracking-tight text-foreground"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {total}
          </span>
          <span className="mt-1 text-[11px] text-muted-foreground">{t('account.total')}</span>
        </div>
      </div>

      {/* Sub-stat chips */}
      <div className="mt-3 flex gap-2">
        <Chip
          label={t('account.todayActive')}
          value={String(todayActive)}
          dotColor={VIZ.green}
        />
        <Chip
          label={t('account.weekNew')}
          value={`+${weekNew}`}
          dotColor={VIZ.blue}
        />
      </div>
    </DataWallCard>
  )
}

function Chip({ label, value, dotColor }: { label: string; value: string; dotColor: string }) {
  return (
    <div className={cn(
      'flex flex-1 items-center gap-1.5 rounded-[8px] border border-border bg-muted/40 px-2.5 py-1.5',
    )}>
      <span className="size-1.5 shrink-0 rounded-full" style={{ background: dotColor }} aria-hidden />
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="ml-auto text-[13px] font-semibold tabular-nums text-foreground">{value}</span>
    </div>
  )
}
