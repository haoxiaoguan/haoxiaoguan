import { useState, useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { SegmentedOptions } from '@/components/ui/segmented-options'
import { DateRangePicker } from '@/features/dashboard/components/DateRangePicker'
import { presetRange, toWindow, type TimeRange } from '@/features/dashboard/utils/time-range'
import { AnalyticsHero } from '../components/AnalyticsHero'
import { AgentFilterBar, type AgentFilter } from '../components/AgentFilterBar'
import { AnalyticsTrendChart } from '../components/AnalyticsTrendChart'
import { AgentStatsTable } from '../components/AgentStatsTable'
import { ModelStatsTable } from '../components/ModelStatsTable'
import { RequestLogTable } from '../components/RequestLogTable'
import { PricingConfigPanel } from '../components/PricingConfigPanel'

type StatsSubTab = 'trend' | 'agent' | 'model'

export default function AnalyticsPage() {
  const { t } = useTranslation('analytics')
  const location = useLocation()
  const [range, setRange] = useState<TimeRange>(() => presetRange('7d', Date.now()))
  const [agentFilter, setAgentFilter] = useState<AgentFilter>('all')
  const [statsSub, setStatsSub] = useState<StatsSubTab>('trend')

  const window = useMemo(() => toWindow(range), [range])
  const agentId = agentFilter === 'all' ? undefined : agentFilter

  // 路由决定当前 tab
  const isRequests = location.pathname.startsWith('/analytics/requests')
  const isPricing = location.pathname.startsWith('/analytics/pricing')
  const isStats = !isRequests && !isPricing

  const statsSubItems = useMemo(
    () => [
      { value: 'trend', label: t('subTab.trend') },
      { value: 'agent', label: t('subTab.agent') },
      { value: 'model', label: t('subTab.model') },
    ],
    [t],
  )

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      {/* 顶部工具栏：时间范围 + Agent 筛选（请求日志/数据统计共享） */}
      {!isPricing && (
        <div className="flex items-center justify-between gap-3">
          <AgentFilterBar value={agentFilter} onChange={setAgentFilter} />
          <DateRangePicker value={range} onChange={setRange} />
        </div>
      )}

      {/* 数据统计 */}
      {isStats && (
        <div className="flex min-h-0 flex-1 flex-col gap-4">
          <AnalyticsHero window={window} agentId={agentId} />
          <div className="flex items-center justify-end">
            <SegmentedOptions items={statsSubItems} value={statsSub} onChange={(v) => setStatsSub(v as StatsSubTab)} />
          </div>
          <div className="min-h-0 flex-1">
            {statsSub === 'trend' && <AnalyticsTrendChart window={window} agentId={agentId} />}
            {statsSub === 'agent' && (
              <AgentStatsTable window={window} onSelectAgent={(a) => setAgentFilter(a as AgentFilter)} />
            )}
            {statsSub === 'model' && <ModelStatsTable window={window} agentId={agentId} />}
          </div>
        </div>
      )}

      {/* 请求日志 */}
      {isRequests && (
        <div className="min-h-0 flex-1">
          <RequestLogTable window={window} agentId={agentId} />
        </div>
      )}

      {/* 定价配置 */}
      {isPricing && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <PricingConfigPanel />
        </div>
      )}
    </div>
  )
}
