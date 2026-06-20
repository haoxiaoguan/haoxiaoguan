import { useState, useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { DateRangePicker } from '@/features/dashboard/components/DateRangePicker'
import { presetRange, toWindow, type TimeRange } from '@/features/dashboard/utils/time-range'
import { AnalyticsHero } from '../components/AnalyticsHero'
import { AgentFilterBar, type AgentFilter } from '../components/AgentFilterBar'
import { AnalyticsTrendChart } from '../components/AnalyticsTrendChart'
import { AgentStatsTable } from '../components/AgentStatsTable'
import { ModelStatsTable } from '../components/ModelStatsTable'
import { RequestLogTable } from '../components/RequestLogTable'
import { PricingConfigPanel } from '../components/PricingConfigPanel'

export default function AnalyticsPage() {
  const location = useLocation()
  const [range, setRange] = useState<TimeRange>(() => presetRange('7d', Date.now()))
  const [agentFilter, setAgentFilter] = useState<AgentFilter>('all')

  const window = useMemo(() => toWindow(range), [range])
  const agentId = agentFilter === 'all' ? undefined : agentFilter

  const isRequests = location.pathname.startsWith('/analytics/requests')
  const isPricing = location.pathname.startsWith('/analytics/pricing')
  const isStats = !isRequests && !isPricing

  return (
    <div className="flex h-[calc(100vh-98px)] min-h-0 flex-col gap-4 px-6 py-5">
      {/* 顶部工具栏（数据统计 / 请求日志共享） */}
      {!isPricing && (
        <div className="flex items-center justify-between gap-3">
          <AgentFilterBar value={agentFilter} onChange={setAgentFilter} />
          <DateRangePicker value={range} onChange={setRange} />
        </div>
      )}

      {/* 数据统计：KPI + 趋势 + Agent 表 + 模型表（纵向排列） */}
      {isStats && (
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
          <AnalyticsHero window={window} agentId={agentId} />
          <AnalyticsTrendChart window={window} agentId={agentId} />
          <AgentStatsTable window={window} onSelectAgent={(a) => setAgentFilter(a as AgentFilter)} />
          <ModelStatsTable window={window} agentId={agentId} />
        </div>
      )}

      {/* 请求日志 */}
      {isRequests && <RequestLogTable window={window} agentId={agentId} />}

      {/* 定价配置 */}
      {isPricing && (
        <PricingConfigPanel />
      )}
    </div>
  )
}
