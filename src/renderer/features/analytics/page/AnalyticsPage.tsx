import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { AnalyticsHero } from '../components/AnalyticsHero'
import { AgentFilterBar, type AgentFilter } from '../components/AgentFilterBar'
import { AnalyticsTrendChart } from '../components/AnalyticsTrendChart'
import { AgentStatsTable } from '../components/AgentStatsTable'
import { ModelStatsTable } from '../components/ModelStatsTable'
import { RequestLogTable } from '../components/RequestLogTable'
import { PricingConfigPanel } from '../components/PricingConfigPanel'
import type { AnalyticsWindowDto } from '@shared/api-types'

type RangePreset = '1d' | '7d' | '30d'
type TabId = 'overview' | 'agentDetail' | 'modelStats' | 'requestLog' | 'pricing'

const PRESET_DAYS: Record<RangePreset, number> = { '1d': 1, '7d': 7, '30d': 30 }
const RANGE_OPTIONS: RangePreset[] = ['1d', '7d', '30d']
const TAB_OPTIONS: TabId[] = ['overview', 'agentDetail', 'modelStats', 'requestLog', 'pricing']

function presetToWindow(days: number): AnalyticsWindowDto {
  const now = Math.floor(Date.now() / 1000)
  return { startSec: now - days * 86400, endSec: now }
}

export default function AnalyticsPage() {
  const { t } = useTranslation()
  const [rangePreset, setRangePreset] = useState<RangePreset>('7d')
  const [agentFilter, setAgentFilter] = useState<AgentFilter>('all')
  const [activeTab, setActiveTab] = useState<TabId>('overview')
  const window = useMemo(() => presetToWindow(PRESET_DAYS[rangePreset]), [rangePreset])
  const agentId = agentFilter === 'all' ? undefined : agentFilter

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      {/* 顶部控制栏 */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          {RANGE_OPTIONS.map((r) => (
            <Button
              key={r}
              variant={rangePreset === r ? 'default' : 'outline'}
              size="sm"
              className="text-xs"
              onClick={() => setRangePreset(r)}
            >
              {t(`analytics:range.${r}`)}
            </Button>
          ))}
        </div>
        <AgentFilterBar value={agentFilter} onChange={setAgentFilter} />
      </div>

      {/* Tab 按钮 */}
      <div className="flex items-center gap-1 border-b border-border/40 pb-2">
        {TAB_OPTIONS.map((tab) => (
          <Button
            key={tab}
            variant="ghost"
            size="sm"
            className={cn('text-xs', activeTab === tab && 'bg-muted font-medium')}
            onClick={() => setActiveTab(tab)}
          >
            {t(`analytics:tab.${tab}`)}
          </Button>
        ))}
      </div>

      {/* Tab 内容 */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'overview' && (
          <div className="flex flex-col gap-4">
            <AnalyticsHero window={window} agentId={agentId} />
            <AnalyticsTrendChart window={window} agentId={agentId} />
            <AgentStatsTable window={window} onSelectAgent={(a) => setAgentFilter(a as AgentFilter)} />
          </div>
        )}
        {activeTab === 'agentDetail' && (
          <div className="flex flex-col gap-4">
            <AnalyticsTrendChart window={window} agentId={agentId} />
            <ModelStatsTable window={window} agentId={agentId} />
          </div>
        )}
        {activeTab === 'modelStats' && <ModelStatsTable window={window} agentId={agentId} />}
        {activeTab === 'requestLog' && <RequestLogTable window={window} agentId={agentId} />}
        {activeTab === 'pricing' && <PricingConfigPanel />}
      </div>
    </div>
  )
}
