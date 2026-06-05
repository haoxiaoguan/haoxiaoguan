import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { cn } from '@/lib/utils'

const RANGE_LABEL_KEYS: Record<TrendRange, string> = {
  '1d': 'trend.rangeToday',
  '7d': 'trend.rangeWeek',
  '30d': 'trend.rangeMonth',
}

const LS_REFRESH_KEY = 'datawall.refreshInterval'

/** Interval options in seconds; 0 means disabled. */
const REFRESH_OPTIONS: { labelKey: string; value: number }[] = [
  { labelKey: 'datawall.interval.off', value: 0 },
  { labelKey: 'datawall.interval.5s',  value: 5 },
  { labelKey: 'datawall.interval.10s', value: 10 },
  { labelKey: 'datawall.interval.30s', value: 30 },
  { labelKey: 'datawall.interval.60s', value: 60 },
]

function readStoredInterval(): number {
  try {
    const raw = localStorage.getItem(LS_REFRESH_KEY)
    if (raw !== null) {
      const n = Number(raw)
      if (Number.isFinite(n) && n >= 0) return n
    }
  } catch {
    // ignore
  }
  return 0
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

  // ── Auto-refresh state ───────────────────────────────────────────────────────
  const [refreshInterval, setRefreshIntervalState] = useState<number>(readStoredInterval)
  const [refreshNonce, setRefreshNonce] = useState(0)

  // ── Full data reload (used by auto-refresh tick) ─────────────────────────────
  const reloadAll = useCallback(() => {
    const currentRange = rangeRef.current
    void usageService.syncUsageSources().catch(() => undefined)
    void activityService.syncActivity().catch(() => undefined)
    void sessionsService
      .probeTools()
      .then((result) => setTools(result))
      .catch(() => undefined)
    void usageService
      .getUsageSummary(currentRange)
      .then((data) => {
        setUsageSummary(data)
        setLastSyncedAt(data.lastSyncedAt ?? Date.now())
      })
      .catch(() => undefined)
    DASHBOARD_PLATFORMS.forEach((p) => {
      void fetchAccounts(p)
    })
    setRefreshNonce((n) => n + 1)
  }, [fetchAccounts])

  // ── Auto-refresh interval effect ─────────────────────────────────────────────
  useEffect(() => {
    if (refreshInterval <= 0) return
    const id = setInterval(reloadAll, refreshInterval * 1000)
    return () => clearInterval(id)
  }, [refreshInterval, reloadAll])

  // ── Mount effects ────────────────────────────────────────────────────────────
  useEffect(() => {
    DASHBOARD_PLATFORMS.forEach((p) => {
      void fetchAccounts(p)
    })
    void usageService.syncUsageSources().catch(() => undefined)
    void activityService.syncActivity().catch(() => undefined)
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
        // Four-way sum: input + output + cacheCreation + cacheRead (cache included)
        totalTokens:
          usageSummary.inputTokens +
          usageSummary.outputTokens +
          usageSummary.cacheReadTokens +
          usageSummary.cacheCreationTokens,
        inputTokens: usageSummary.inputTokens,
        outputTokens: usageSummary.outputTokens,
        cacheTokens: usageSummary.cacheReadTokens + usageSummary.cacheCreationTokens,
        requests: usageSummary.requests,
      }
    : { totalTokens: 0, inputTokens: 0, outputTokens: 0, cacheTokens: 0, requests: 0 }

  const rangeLabel = t(RANGE_LABEL_KEYS[range])

  // ── Last sync display ────────────────────────────────────────────────────────
  const syncLabel = useMemo(() => {
    if (!lastSyncedAt) return null
    const d = new Date(lastSyncedAt)
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
  }, [lastSyncedAt])

  // ── Interval selector handler ────────────────────────────────────────────────
  const handleIntervalChange = useCallback((val: number) => {
    setRefreshIntervalState(val)
    try { localStorage.setItem(LS_REFRESH_KEY, String(val)) } catch { /* ignore */ }
  }, [])

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between px-5 pb-2 pt-4">
        <h1 className="text-[15px] font-semibold text-foreground">
          {t('datawall.title', '控制中心')}
        </h1>

        {/* Right: last-sync time + auto-refresh selector */}
        <div className="flex items-center gap-2">
          {syncLabel != null && (
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <RefreshCw className="size-3" strokeWidth={1.8} aria-hidden />
              {syncLabel}
            </span>
          )}

          {/* Auto-refresh inline selector */}
          <div className="flex items-center gap-1 rounded-md bg-muted/50 px-1 py-0.5">
            <span className="text-[10px] text-muted-foreground">
              {t('datawall.autoRefresh')}
            </span>
            <div className="flex items-center gap-0.5">
              {REFRESH_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => handleIntervalChange(opt.value)}
                  className={cn(
                    'rounded px-1.5 py-0.5 text-[10px] font-medium transition-all duration-100',
                    refreshInterval === opt.value
                      ? 'bg-card text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                  aria-pressed={refreshInterval === opt.value}
                >
                  {t(opt.labelKey)}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Bento data wall — decoupled rows: the top row keeps a definite height
          (the chart needs one), content-heavy rows size to their content so
          nothing overflows or overlaps. */}
      <div
        data-testid="datawall-grid"
        className="min-h-0 flex-1 overflow-y-auto px-5 pb-5"
      >
        <div className="flex flex-col gap-2.5">
          {/* Top: account hero | trend chart | platform donut (definite height) */}
          <div className="grid h-[200px] grid-cols-12 grid-rows-1 gap-2.5">
            <div className="col-span-3">
              <AccountHeroCard
                total={stats.total}
                platformsCovered={stats.platformsCovered}
                platformsTotal={stats.platformsTotal}
                todayActive={stats.todayActive}
                weekNew={stats.weekNew}
              />
            </div>
            <div className="col-span-6">
              <TrendChartCard range={range} onRangeChange={setRange} refreshNonce={refreshNonce} />
            </div>
            <div className="col-span-3">
              <PlatformDonutCard items={stats.perPlatform} total={stats.total} />
            </div>
          </div>

          {/* Middle: pool health | credential health | token summary */}
          <div className="grid grid-cols-12 auto-rows-[minmax(132px,auto)] gap-2.5">
            <div className="col-span-4">
              <PoolHealthCard pool={qh.pool} onRefresh={qh.refresh} />
            </div>
            <div className="col-span-4">
              <CredentialHealthCard credential={qh.credential} onRefresh={qh.refresh} />
            </div>
            <div className="col-span-4">
              <TokenSummaryCard rangeLabel={rangeLabel} {...tokenProps} />
            </div>
          </div>

          {/* Bottom: attention list | session activity */}
          <div className="grid grid-cols-12 auto-rows-[minmax(120px,auto)] gap-2.5">
            <div className="col-span-8">
              <AttentionListCard items={qh.attention} onRefresh={qh.refresh} />
            </div>
            <div className="col-span-4">
              <SessionActivityCard tools={sessionTools} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
