import { useTranslation } from 'react-i18next'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'

export type AgentFilter = 'all' | 'claude' | 'codex' | 'gemini-cli' | 'kiro' | 'qoder'

const AGENT_OPTIONS: AgentFilter[] = ['all', 'claude', 'codex', 'gemini-cli', 'kiro', 'qoder']

const AGENT_LABEL_KEYS: Record<AgentFilter, string> = {
  all: 'analytics:agent.all',
  claude: 'analytics:agent.claude',
  codex: 'analytics:agent.codex',
  'gemini-cli': 'analytics:agent.geminiCli',
  kiro: 'analytics:agent.kiro',
  qoder: 'analytics:agent.qoder',
}

interface AgentFilterBarProps {
  value: AgentFilter
  onChange: (value: AgentFilter) => void
}

export function AgentFilterBar({ value, onChange }: AgentFilterBarProps) {
  const { t } = useTranslation()
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(v) => {
        if (v) onChange(v as AgentFilter)
      }}
      className="justify-start"
    >
      {AGENT_OPTIONS.map((agent) => (
        <ToggleGroupItem key={agent} value={agent} className={cn('text-xs')}>
          {t(AGENT_LABEL_KEYS[agent])}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
