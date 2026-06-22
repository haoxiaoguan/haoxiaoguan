import { useState, useMemo, useCallback, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { DateRangePicker } from '@/features/dashboard/components/DateRangePicker'
import { presetRange, toWindow, type TimeRange } from '@/features/dashboard/utils/time-range'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AnalyticsHero } from '../components/AnalyticsHero'
import { AgentFilterBar, type AgentFilter } from '../components/AgentFilterBar'
import { AnalyticsTrendChart } from '../components/AnalyticsTrendChart'
import { AgentStatsTable } from '../components/AgentStatsTable'
import { ModelStatsTable } from '../components/ModelStatsTable'
import { RequestLogTable } from '../components/RequestLogTable'
import { PricingConfigPanel } from '../components/PricingConfigPanel'

const LS_REFRESH_KEY = 'analytics.refreshInterval'
const REFRESH_STEPS = [0, 5, 10, 30, 60]

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

export default function AnalyticsPage() {
  const location = useLocation()
  const [range, setRange] = useState<TimeRange>(() => presetRange('7d', Date.now()))
  const [agentFilter, setAgentFilter] = useState<AgentFilter>('all')
  const [refreshInterval, setRefreshIntervalState] = useState<number>(readStoredInterval)
  const [refreshNonce, setRefreshNonce] = useState(0)

  const window = useMemo(() => toWindow(range), [range])
  const agentId = agentFilter === 'all' ? undefined : agentFilter

  const isRequests = location.pathname.startsWith('/analytics/requests')
  const isPricing = location.pathname.startsWith('/analytics/pricing')
  const isStats = !isRequests && !isPricing

  const handleIntervalChange = useCallback((val: number) => {
    setRefreshIntervalState(val)
    try { localStorage.setItem(LS_REFRESH_KEY, String(val)) } catch { /* ignore */ }
  }, [])

  const cycleRefresh = () => {
    const idx = REFRESH_STEPS.indexOf(refreshInterval)
    handleIntervalChange(REFRESH_STEPS[(idx + 1) % REFRESH_STEPS.length] ?? 0)
  }

  // 定时刷新
  useEffect(() => {
    if (refreshInterval <= 0) return
    const id = setInterval(() => setRefreshNonce((n) => n + 1), refreshInterval * 1000)
    return () => clearInterval(id)
  }, [refreshInterval])

  return (
    <div className="flex h-[calc(100vh-98px)] min-h-0 flex-col gap-4 px-6 py-5">
      {/* 顶部工具栏 */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {!isPricing && <AgentFilterBar value={agentFilter} onChange={setAgentFilter} />}
        </div>
        <div className="flex items-center gap-2">
          {!isPricing && <DateRangePicker value={range} onChange={setRange} />}
          {!isPricing && (
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className={cn('h-8 w-8', refreshInterval > 0 && 'text-primary')}
                    onClick={cycleRefresh}
                  >
                    <RefreshCw className={cn('h-4 w-4', )} strokeWidth={1.9} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="text-xs">
                  {refreshInterval > 0 ? `${refreshInterval}s` : '关闭'}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      </div>

      {/* 数据统计：KPI + 趋势 + Agent 表 + 模型表（纵向排列） */}
      {isStats && (
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
          <AnalyticsHero key={`hero-${refreshNonce}`} window={window} agentId={agentId} />
          <AnalyticsTrendChart key={`trend-${refreshNonce}`} window={window} agentId={agentId} />
          <AgentStatsTable key={`agent-${refreshNonce}`} window={window} onSelectAgent={(a) => setAgentFilter(a as AgentFilter)} />
          <ModelStatsTable key={`model-${refreshNonce}`} window={window} agentId={agentId} />
        </div>
      )}

      {/* 请求日志 */}
      {isRequests && <RequestLogTable key={`log-${refreshNonce}`} window={window} agentId={agentId} />}

      {/* 定价配置 */}
      {isPricing && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <PricingConfigPanel />
        </div>
      )}
    </div>
  )
}
