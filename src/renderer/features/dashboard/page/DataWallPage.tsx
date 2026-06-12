import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAccountStore } from '@/stores/accountStore'
import { sessionsService, systemService } from '@/services/tauri'
import type { ToolProbeDto } from '@shared/api-types'
import { DASHBOARD_PLATFORMS } from '../platforms'
import { useAccountStats } from '../hooks/useAccountStats'
import { useQuotaHealthSummary } from '../hooks/useQuotaHealthSummary'
import type { TimeRange } from '../utils/time-range'
import { presetRange } from '../utils/time-range'
import { KpiStrip } from '../datawall/KpiStrip'
import { TrendChartCard } from '../datawall/TrendChartCard'
import { PlatformDonutCard } from '../datawall/PlatformDonutCard'
import { AccountHealthCard } from '../datawall/AccountHealthCard'
import { AttentionListCard } from '../datawall/AttentionListCard'

const LS_REFRESH_KEY = 'datawall.refreshInterval'

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
 * 仪表盘（数据墙）—— 一屏三段：
 * ① KPI 条（账号/会话/MCP/Skills）
 * ② 趋势分析整行（活跃热力图 + 5 数值维度；时间范围选择器与自动刷新内嵌卡片右上）
 * ③ 底部三卡（平台分布 / 账号健康 / 需关注）
 */
export default function DataWallPage() {
  const fetchAccounts = useAccountStore((s) => s.fetchAccounts)

  // 全局时间范围（趋势数值维度 + Token/费用统计行跟随），默认近 7 天。
  const [range, setRange] = useState<TimeRange>(() => presetRange('7d', Date.now()))

  // ── Session tools（KPI 会话数 + 会话活跃卡）────────────────────────────────
  const [tools, setTools] = useState<ToolProbeDto[]>([])

  // ── Auto-refresh state ───────────────────────────────────────────────────────
  const [refreshInterval, setRefreshIntervalState] = useState<number>(readStoredInterval)
  const [refreshNonce, setRefreshNonce] = useState(0)

  // ── 只读刷新（自动刷新 tick / usage:synced 事件用）────────────────────────────
  // 对齐 cc-switch：同步全部由后端固定 60s 定时（main.ts）负责，这里只重读 DB，不再触发
  // syncUsageSources/syncActivity——避免「选 5s 就每 5s 全量 syncAll+rebuildRollups」的浪费。
  const reloadAll = useCallback(() => {
    void sessionsService
      .probeTools()
      .then((result) => setTools(result))
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

  // ── 主进程后台同步线程完成事件 → 只读刷新 ───────────────────────────────────────
  // 主进程每 60s 同步 usage+activity（main.ts），完成后推 usage:synced。仪表盘据此重读，
  // **与卡片内「自动刷新」档位无关**——即使档位为关闭，后台线程仍驱动数据更新。
  const reloadAllRef = useRef(reloadAll)
  reloadAllRef.current = reloadAll
  useEffect(() => {
    const unsub = systemService.onUsageSynced(() => reloadAllRef.current())
    return unsub
  }, [])

  // ── Mount effects（只读：账号 + 工具探针；用量/活动同步由后端 60s 定时负责）──────────
  useEffect(() => {
    DASHBOARD_PLATFORMS.forEach((p) => {
      void fetchAccounts(p)
    })
    void sessionsService
      .probeTools()
      .then((result) => setTools(result))
      .catch(() => undefined)
  }, [fetchAccounts])

  // ── Derived stats ────────────────────────────────────────────────────────────
  const stats = useAccountStats()
  const qh = useQuotaHealthSummary()

  // 进入仪表盘后自动加载「账号健康 / 需关注」（此前需手点各自的刷新）。
  // 等账号就绪后触发一次：配额走缓存(ensureMany→getQuotaState)、凭证校验一次。用 ref 守卫
  // 保证同一会话只自动跑一次（避免每次切到仪表盘都重复校验），空账号则不触发。
  const qhRef = useRef(qh)
  qhRef.current = qh
  const autoLoadedHealthRef = useRef(false)
  useEffect(() => {
    if (autoLoadedHealthRef.current || stats.total <= 0) return
    autoLoadedHealthRef.current = true
    void qhRef.current.refresh().catch(() => undefined)
  }, [stats.total])

  const sessionsTotal = useMemo(() => tools.reduce((sum, e) => sum + e.count, 0), [tools])
  // 最近活跃：lastActiveAt 最大的工具（KPI 会话卡副文字）。
  const lastActive = useMemo(() => {
    let best: { tool: string; at: number } | null = null
    for (const e of tools) {
      if (e.lastActiveAt != null && (best === null || e.lastActiveAt > best.at)) {
        best = { tool: e.tool, at: e.lastActiveAt }
      }
    }
    return best
  }, [tools])

  // ── Interval selector handler ────────────────────────────────────────────────
  const handleIntervalChange = useCallback((val: number) => {
    setRefreshIntervalState(val)
    try { localStorage.setItem(LS_REFRESH_KEY, String(val)) } catch { /* ignore */ }
  }, [])

  return (
    // absolute inset-0 锚定 AppShell 的 ScrollArea(relative + flex-1 确定高)：Outlet 包裹层是
    // min-h-full(height:auto,供普通页面滚动)，h-full 在其上解析不了——仪表盘要锁一屏，
    // 必须脱离滚动流直接吃 ScrollArea 的盒子；absolute 不贡献滚动高度，页面级无滚动条。
    <div className="absolute inset-0 flex flex-col overflow-hidden">
      <div
        data-testid="datawall-grid"
        className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)_minmax(150px,205px)] gap-2.5 overflow-hidden px-5 pb-5 pt-4"
      >
        {/* ① KPI 条 */}
        <KpiStrip
          accountsTotal={stats.total}
          weekNew={stats.weekNew}
          platformsCovered={stats.platformsCovered}
          platformsTotal={stats.platformsTotal}
          sessionsTotal={sessionsTotal}
          lastActive={lastActive}
          refreshNonce={refreshNonce}
        />

        {/* ② 趋势分析（整行） */}
        <div className="min-h-0">
          <TrendChartCard
            range={range}
            onRangeChange={setRange}
            refreshInterval={refreshInterval}
            onRefreshIntervalChange={handleIntervalChange}
            refreshNonce={refreshNonce}
          />
        </div>

        {/* ③ 底部三卡 */}
        <div className="grid min-h-0 grid-cols-12 grid-rows-1 gap-2.5">
          <div className="col-span-4 min-h-0">
            <PlatformDonutCard items={stats.perPlatform} total={stats.total} />
          </div>
          <div className="col-span-4 min-h-0">
            <AccountHealthCard pool={qh.pool} credential={qh.credential} onRefresh={qh.refresh} />
          </div>
          <div className="col-span-4 min-h-0">
            <AttentionListCard items={qh.attention} onRefresh={qh.refresh} />
          </div>
        </div>
      </div>
    </div>
  )
}
