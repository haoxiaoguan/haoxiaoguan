import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type { AttentionItem } from '../utils/quota-health-summary'
import { DataWallCard } from './DataWallCard'
import { VIZ } from './viz-colors'

interface Props {
  items: AttentionItem[]
  onRefresh?: () => void
  refreshing?: boolean
}

/** Dot color per attention kind. */
function kindColor(kind: AttentionItem['kind']): string {
  if (kind === 'quotaExhausted') return VIZ.red
  return VIZ.amber
}

/** Detail text color per attention kind. */
function detailColor(kind: AttentionItem['kind']): string {
  if (kind === 'quotaExhausted') return VIZ.red
  return VIZ.amber
}

/**
 * Deterministic background color for a platform chip based on the
 * platform string — cycles through VIZ palette.
 */
function platformChipColor(platform: string): string {
  const PALETTE = [VIZ.blue, VIZ.violet, VIZ.green, VIZ.amber, VIZ.gray] as const
  let hash = 0
  for (let i = 0; i < platform.length; i++) {
    hash = (hash * 31 + platform.charCodeAt(i)) >>> 0
  }
  return PALETTE[hash % PALETTE.length]
}

/**
 * Attention list card — wide card listing cross-platform accounts needing
 * attention (quota exhausted / low / expiring credential).
 * Shows an honest positive empty state when there are no issues.
 */
export function AttentionListCard({ items, onRefresh, refreshing = false }: Props) {
  const { t } = useTranslation('dashboard')

  const headerRight =
    items.length > 0 ? (
      <span
        className="rounded-[5px] px-1.5 py-0.5 text-[10px] font-bold leading-none text-white"
        style={{ background: VIZ.red }}
      >
        {t('attention.count', { n: items.length })}
      </span>
    ) : undefined

  return (
    <DataWallCard title={t('attention.title')} headerRight={headerRight}>
      {items.length === 0 ? (
        <EmptyState onRefresh={onRefresh} refreshing={refreshing} />
      ) : (
        <ItemList items={items} />
      )}
    </DataWallCard>
  )
}

// ── Item list ─────────────────────────────────────────────────────────────────

function ItemList({ items }: { items: AttentionItem[] }) {
  const { t } = useTranslation('dashboard')

  return (
    <div className="flex h-full min-h-0 flex-col divide-y divide-border overflow-y-auto">
      {items.map((item) => {
        const chipColor = platformChipColor(item.platform)
        const abbr = item.platform.slice(0, 2).toUpperCase()
        const dot  = kindColor(item.kind)
        const detailStyle = detailColor(item.kind)

        return (
          <div
            key={`${item.accountId}-${item.kind}`}
            className="flex items-center gap-2 py-2 first:pt-0 last:pb-0"
          >
            {/* Status dot */}
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ background: dot }}
              aria-hidden
            />

            {/* Platform chip */}
            <span
              className="shrink-0 rounded-[4px] px-1.5 py-0.5 text-[10px] font-bold uppercase leading-none text-white"
              style={{ background: chipColor }}
              title={item.platform}
            >
              {abbr}
            </span>

            {/* Identifier */}
            <span className="min-w-0 flex-1 truncate text-[12px] text-foreground">
              {item.identifier}
            </span>

            {/* Kind label */}
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {t(`attention.${item.kind}`)}
            </span>

            {/* Detail */}
            <span
              className="shrink-0 text-[11px] font-semibold tabular-nums"
              style={{ color: detailStyle }}
            >
              {item.detail}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ── Empty ─────────────────────────────────────────────────────────────────────

function EmptyState({
  onRefresh,
  refreshing,
}: {
  onRefresh?: () => void
  refreshing: boolean
}) {
  const { t } = useTranslation('dashboard')

  return (
    <div className="flex h-20 flex-col items-center justify-center gap-2.5">
      <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
        <span
          className="size-3 rounded-full text-center text-[10px] font-bold leading-3 text-white"
          style={{ background: VIZ.green, lineHeight: '12px' }}
          aria-hidden
        >
          ✓
        </span>
        {t('attention.none')}
      </span>
      {onRefresh != null && (
        <button
          type="button"
          disabled={refreshing}
          onClick={onRefresh}
          className={cn(
            'rounded-[7px] border border-border bg-muted/40 px-3 py-1',
            'text-[11px] font-medium text-foreground',
            'transition-opacity hover:opacity-75 disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          {refreshing ? t('actions.refreshing') : t('actions.refresh')}
        </button>
      )}
    </div>
  )
}
