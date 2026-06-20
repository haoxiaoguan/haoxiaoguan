import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { SegmentedOptions } from '@/components/ui/segmented-options'

export type AgentFilter = 'all' | 'claude' | 'codex' | 'gemini-cli' | 'kiro' | 'qoder'

interface AgentFilterBarProps {
  value: AgentFilter
  onChange: (value: AgentFilter) => void
}

export function AgentFilterBar({ value, onChange }: AgentFilterBarProps) {
  const { t } = useTranslation('analytics')
  const items = useMemo(
    () => [
      { value: 'all', label: t('agent.all') },
      { value: 'claude', label: t('agent.claude') },
      { value: 'codex', label: t('agent.codex') },
      { value: 'gemini-cli', label: t('agent.geminiCli') },
      { value: 'kiro', label: t('agent.kiro') },
      { value: 'qoder', label: t('agent.qoder') },
    ],
    [t],
  )
  return <SegmentedOptions items={items} value={value} onChange={(v) => onChange(v as AgentFilter)} />
}
