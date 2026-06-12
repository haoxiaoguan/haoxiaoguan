import { useTranslation } from 'react-i18next'
import type { PoolHealth, CredentialHealth } from '../utils/quota-health-summary'
import { DataWallCard } from './DataWallCard'
import { VIZ } from './viz-colors'

interface Props {
  pool: PoolHealth
  credential: CredentialHealth
  onRefresh: () => void
  refreshing?: boolean
}

/**
 * 账号健康卡 —— 池（可用/冷却/耗尽 堆叠条）+ 凭证（有效/将过期/失效）两段合一。
 * 任一侧无数据时显示统一空态（刷新触发配额缓存 + 凭证校验）。
 */
export function AccountHealthCard({ pool, credential, onRefresh, refreshing = false }: Props) {
  const { t } = useTranslation('dashboard')

  return (
    <DataWallCard title={t('accountHealth.title')}>
      {pool.hasData || credential.hasData ? (
        <FilledState pool={pool} credential={credential} />
      ) : (
        <EmptyState onRefresh={onRefresh} refreshing={refreshing} />
      )}
    </DataWallCard>
  )
}

// ── Filled ────────────────────────────────────────────────────────────────────

function FilledState({ pool, credential }: { pool: PoolHealth; credential: CredentialHealth }) {
  const { t } = useTranslation('dashboard')
  const safe = pool.total > 0 ? pool.total : 1

  return (
    <div className="flex h-full flex-col justify-between gap-2">
      {/* 池：堆叠条 + 行内三色计数 */}
      <div>
        <div className="flex items-baseline justify-between">
          <span className="text-[11px] text-muted-foreground">{t('pool.inPool')}</span>
          <span
            className="text-[18px] font-extrabold leading-none tracking-tight text-foreground"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {pool.total}
          </span>
        </div>
        <div
          className="mt-2 flex h-[8px] w-full overflow-hidden rounded-full bg-muted/40"
          role="img"
          aria-label={`${t('pool.available')} ${pool.available}, ${t('pool.cooldown')} ${pool.cooldown}, ${t('pool.exhausted')} ${pool.exhausted}`}
        >
          {pool.available > 0 && (
            <div className="h-full transition-all duration-500" style={{ width: `${(pool.available / safe) * 100}%`, background: VIZ.green }} />
          )}
          {pool.cooldown > 0 && (
            <div className="h-full transition-all duration-500" style={{ width: `${(pool.cooldown / safe) * 100}%`, background: VIZ.amber }} />
          )}
          {pool.exhausted > 0 && (
            <div className="h-full transition-all duration-500" style={{ width: `${(pool.exhausted / safe) * 100}%`, background: VIZ.red }} />
          )}
        </div>
        <div className="mt-2 flex items-center gap-3">
          <InlineCount label={t('pool.available')} value={pool.available} color={VIZ.green} />
          <InlineCount label={t('pool.cooldown')} value={pool.cooldown} color={VIZ.amber} />
          <InlineCount label={t('pool.exhausted')} value={pool.exhausted} color={VIZ.red} />
        </div>
      </div>

      {/* 凭证：有效占比 + 行内计数 */}
      <div className="border-t border-border/70 pt-2">
        <div className="flex items-baseline justify-between">
          <span className="text-[11px] text-muted-foreground">{t('credential.title')}</span>
          <span className="text-[13px] font-semibold tabular-nums" style={{ color: VIZ.green }}>
            {credential.valid}
            <span className="text-[11px] font-normal text-muted-foreground"> / {credential.total} {t('credential.validOf')}</span>
          </span>
        </div>
        <div className="mt-2 flex items-center gap-3">
          <InlineCount label={t('credential.valid')} value={credential.valid} color={VIZ.green} />
          <InlineCount label={t('credential.expiring')} value={credential.expiring} color={VIZ.amber} />
          <InlineCount label={t('credential.invalid')} value={credential.invalid} color={VIZ.red} />
        </div>
      </div>
    </div>
  )
}

function InlineCount({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <span className="size-1.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
      {label}
      <span className="text-[12px] font-semibold tabular-nums text-foreground">{value}</span>
    </span>
  )
}

// ── Empty ─────────────────────────────────────────────────────────────────────

function EmptyState({ onRefresh, refreshing }: { onRefresh: () => void; refreshing: boolean }) {
  const { t } = useTranslation('dashboard')

  return (
    <div className="flex h-full min-h-24 flex-col items-center justify-center gap-3">
      <span className="text-[12px] text-muted-foreground">{t('accountHealth.empty')}</span>
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
