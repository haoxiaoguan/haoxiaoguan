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
 * 三行用分数高度（fr）铺满内容区，避免底部留白；窗口过矮时各行回退到 min 高度并滚动。
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
        costUsd: usageSummary.totalCostUsd ?? 0,
      }
    : { totalTokens: 0, inputTokens: 0, outputTokens: 0, cacheTokens: 0, requests: 0, costUsd: 0 }

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
      {/* Header —— 去掉「控制中心」副标题（与顶栏「仪表盘」重复），仅保留「最后同步时间 + 自动刷新」控件并靠右。 */}
      <div className="flex shrink-0 items-center justify-end gap-2 px-5 pb-2 pt-3">
        {syncLabel != null && (
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground" title={t('datawall.lastSynced', '最后同步')}>
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

      {/* Bento data wall —— 三行用 fr 分数高度铺满内容区（不再固定 200px / auto 行高，
          消除底部留白）。每行内部 grid-rows-1 让 3 张卡片等高拉伸；窗口过矮时各行回退到
          minmax 的最小高度并由容器滚动。 */}
      <div
        data-testid="datawall-grid"
        className="grid min-h-0 flex-1 grid-rows-[minmax(200px,1.05fr)_minmax(160px,1fr)_minmax(150px,1fr)] gap-2.5 overflow-y-auto px-5 pb-5"
      >
        {/* Top: account hero | trend chart | platform donut */}
        <div className="grid min-h-0 grid-cols-12 grid-rows-1 gap-2.5">
          <div className="col-span-3 min-h-0">
            <AccountHeroCard
              total={stats.total}
              platformsCovered={stats.platformsCovered}
              platformsTotal={stats.platformsTotal}
              todayActive={stats.todayActive}
              weekNew={stats.weekNew}
            />
          </div>
          <div className="col-span-6 min-h-0">
            <TrendChartCard range={range} onRangeChange={setRange} refreshNonce={refreshNonce} />
          </div>
          <div className="col-span-3 min-h-0">
            <PlatformDonutCard items={stats.perPlatform} total={stats.total} />
          </div>
        </div>

        {/* Middle: pool health | credential health | token summary */}
        <div className="grid min-h-0 grid-cols-12 grid-rows-1 gap-2.5">
          <div className="col-span-4 min-h-0">
            <PoolHealthCard pool={qh.pool} onRefresh={qh.refresh} />
          </div>
          <div className="col-span-4 min-h-0">
            <CredentialHealthCard credential={qh.credential} onRefresh={qh.refresh} />
          </div>
          <div className="col-span-4 min-h-0">
            <TokenSummaryCard rangeLabel={rangeLabel} {...tokenProps} />
          </div>
        </div>

        {/* Bottom: attention list | session activity */}
        <div className="grid min-h-0 grid-cols-12 grid-rows-1 gap-2.5">
          <div className="col-span-8 min-h-0">
            <AttentionListCard items={qh.attention} onRefresh={qh.refresh} />
          </div>
          <div className="col-span-4 min-h-0">
            <SessionActivityCard tools={sessionTools} />
          </div>
        </div>
      </div>
    </div>
  )
}
