import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshCw } from 'lucide-react'
import { useAccountStore } from '@/stores/accountStore'
import { usageService, activityService, sessionsService } from '@/services/tauri'
import type { UsageSummaryResponse } from '@/types'
import type { ToolProbeDto } from '@shared/api-types'
import { DASHBOARD_PLATFORMS } from '../platforms'
import { useAccountStats } from '../hooks/useAccountStats'
import { useQuotaHealthSummary } from '../hooks/useQuotaHealthSummary'
import type { TrendRange } from '../hooks/useTrendSeries'
import { AccountHeroCard } from '../datawall/AccountHeroCard'
import { PlatformDonutCard } from '../datawall/PlatformDonutCard'
import { TrendChartCard } from '../datawall/TrendChartCard'
import { PoolHealthCard } from '../datawall/PoolHealthCard'
import { CredentialHealthCard } from '../datawall/CredentialHealthCard'
import { TokenSummaryCard } from '../datawall/TokenSummaryCard'
import { AttentionListCard } from '../datawall/AttentionListCard'
import { SessionActivityCard } from '../datawall/SessionActivityCard'

const RANGE_LABEL_KEYS: Record<TrendRange, string> = {
  '1d': 'trend.rangeToday',
  '7d': 'trend.rangeWeek',
  '30d': 'trend.rangeMonth',
}

/**
 * Data wall page — 12-column Bento grid combining 8 metric cards.
 */
export default function DataWallPage() {
  const { t } = useTranslation('dashboard')
  const fetchAccounts = useAccountStore((s) => s.fetchAccounts)

  const [range, setRange] = useState<TrendRange>('7d')

  // ── Usage summary for TokenSummaryCard ──────────────────────────────────────
  const [usageSummary, setUsageSummary] = useState<UsageSummaryResponse | null>(null)
  const rangeRef = useRef(range)
  rangeRef.current = range

  // ── Session tools for SessionActivityCard ───────────────────────────────────
  const [tools, setTools] = useState<ToolProbeDto[]>([])

  // ── Last synced timestamp ────────────────────────────────────────────────────
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null)

  // ── Mount effects ────────────────────────────────────────────────────────────
  useEffect(() => {
    // fire-and-forget: fetch accounts per platform
    DASHBOARD_PLATFORMS.forEach((p) => {
      void fetchAccounts(p)
    })

    // fire-and-forget: sync usage sources
    void usageService.syncUsageSources().catch(() => undefined)

    // fire-and-forget: sync activity
    void activityService.syncActivity().catch(() => undefined)

    // probe session tools
    void sessionsService
      .probeTools()
      .then((result) => setTools(result))
      .catch(() => undefined)
  }, [fetchAccounts])

  // ── Fetch usage summary whenever range changes ───────────────────────────────
  useEffect(() => {
    const thisRange = range
    void usageService
      .getUsageSummary(range)
      .then((data) => {
        // discard stale responses
        if (rangeRef.current !== thisRange) return
        setUsageSummary(data)
        setLastSyncedAt(data.lastSyncedAt ?? Date.now())
      })
      .catch(() => undefined)
  }, [range])

  // ── Derived stats ────────────────────────────────────────────────────────────
  const stats = useAccountStats()
  const qh = useQuotaHealthSummary()

  const sessionTools = useMemo(
    () =>
      tools.map((e) => ({
        tool: e.tool,
        count: e.count,
        lastActiveAt: e.lastActiveAt,
      })),
    [tools],
  )

  const tokenProps = usageSummary
    ? {
        totalTokens: usageSummary.totalTokens,
        inputTokens: usageSummary.inputTokens,
        outputTokens: usageSummary.outputTokens,
        cacheTokens: usageSummary.cacheReadTokens + usageSummary.cacheCreationTokens,
      }
    : { totalTokens: 0, inputTokens: 0, outputTokens: 0, cacheTokens: 0 }

  const rangeLabel = t(RANGE_LABEL_KEYS[range])

  // ── Last sync display ────────────────────────────────────────────────────────
  const syncLabel = useMemo(() => {
    if (!lastSyncedAt) return null
    const d = new Date(lastSyncedAt)
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
  }, [lastSyncedAt])

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between px-5 pb-2 pt-4">
        <h1 className="text-[15px] font-semibold text-foreground">
          {t('datawall.title', '控制中心')}
        </h1>
        {syncLabel != null && (
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <RefreshCw className="size-3" strokeWidth={1.8} aria-hidden />
            {syncLabel}
          </span>
        )}
      </div>

      {/* 12-column Bento grid */}
      <div
        data-testid="datawall-grid"
        className="min-h-0 flex-1 overflow-y-auto px-5 pb-5"
      >
        <div className="grid grid-cols-12 auto-rows-[98px] gap-2.5">
          {/* Row 1: AccountHeroCard (3×2) | TrendChartCard (6×2) | PlatformDonutCard (3×2) */}
          <div className="col-span-3 row-span-2">
            <AccountHeroCard
              total={stats.total}
              platformsCovered={stats.platformsCovered}
              platformsTotal={stats.platformsTotal}
              todayActive={stats.todayActive}
              weekNew={stats.weekNew}
            />
          </div>
          <div className="col-span-6 row-span-2">
            <TrendChartCard
              range={range}
              onRangeChange={setRange}
            />
          </div>
          <div className="col-span-3 row-span-2">
            <PlatformDonutCard
              items={stats.perPlatform}
              total={stats.total}
            />
          </div>

          {/* Row 3: PoolHealthCard (4×1) | CredentialHealthCard (4×1) | TokenSummaryCard (4×1) */}
          <div className="col-span-4">
            <PoolHealthCard
              pool={qh.pool}
              onRefresh={qh.refresh}
            />
          </div>
          <div className="col-span-4">
            <CredentialHealthCard
              credential={qh.credential}
              onRefresh={qh.refresh}
            />
          </div>
          <div className="col-span-4">
            <TokenSummaryCard
              rangeLabel={rangeLabel}
              {...tokenProps}
            />
          </div>

          {/* Row 4: AttentionListCard (8×1) | SessionActivityCard (4×1) */}
          <div className="col-span-8">
            <AttentionListCard
              items={qh.attention}
              onRefresh={qh.refresh}
            />
          </div>
          <div className="col-span-4">
            <SessionActivityCard
              tools={sessionTools}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
