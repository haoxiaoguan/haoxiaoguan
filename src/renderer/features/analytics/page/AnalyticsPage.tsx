import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/ui/page-header'
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

type TopTab = 'stats' | 'requestLog' | 'pricing'
type StatsSubTab = 'trend' | 'agent' | 'model'

export default function AnalyticsPage() {
  const { t } = useTranslation('analytics')
  const [range, setRange] = useState<TimeRange>(() => presetRange('7d', Date.now()))
  const [agentFilter, setAgentFilter] = useState<AgentFilter>('all')
  const [topTab, setTopTab] = useState<TopTab>('stats')
  const [statsSub, setStatsSub] = useState<StatsSubTab>('trend')

  const window = useMemo(() => toWindow(range), [range])
  const agentId = agentFilter === 'all' ? undefined : agentFilter

  const topTabItems = useMemo(
    () => [
      { value: 'stats', label: t('tab.stats') },
      { value: 'requestLog', label: t('tab.requestLog') },
      { value: 'pricing', label: t('tab.pricing') },
    ],
    [t],
  )

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
      <PageHeader title={t('title')} actions={<DateRangePicker value={range} onChange={setRange} />} />

      {/* 顶部 3 tab */}
      <SegmentedOptions items={topTabItems} value={topTab} onChange={(v) => setTopTab(v as TopTab)} />

      {/* 数据统计 tab：KPI + 子维度切换 */}
      {topTab === 'stats' && (
        <div className="flex min-h-0 flex-1 flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <AgentFilterBar value={agentFilter} onChange={setAgentFilter} />
            <SegmentedOptions items={statsSubItems} value={statsSub} onChange={(v) => setStatsSub(v as StatsSubTab)} />
          </div>

          <AnalyticsHero window={window} agentId={agentId} />

          <div className="min-h-0 flex-1">
            {statsSub === 'trend' && <AnalyticsTrendChart window={window} agentId={agentId} />}
            {statsSub === 'agent' && (
              <AgentStatsTable window={window} onSelectAgent={(a) => setAgentFilter(a as AgentFilter)} />
            )}
            {statsSub === 'model' && <ModelStatsTable window={window} agentId={agentId} />}
          </div>
        </div>
      )}

      {/* 请求日志 tab */}
      {topTab === 'requestLog' && (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <AgentFilterBar value={agentFilter} onChange={setAgentFilter} />
          <div className="min-h-0 flex-1">
            <RequestLogTable window={window} agentId={agentId} />
          </div>
        </div>
      )}

      {/* 定价配置 tab */}
      {topTab === 'pricing' && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <PricingConfigPanel />
        </div>
      )}
    </div>
  )
}
