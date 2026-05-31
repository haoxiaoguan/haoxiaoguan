import claudeIcon from '@lobehub/icons-static-svg/icons/claude-color.svg';
import codexIcon from '@lobehub/icons-static-svg/icons/codex-color.svg';
import geminiIcon from '@lobehub/icons-static-svg/icons/gemini-color.svg';
import hermesIcon from '@lobehub/icons-static-svg/icons/hermesagent.svg';
import openCodeIcon from '@lobehub/icons-static-svg/icons/opencode.svg';
import { cn } from '@/lib/utils';

export type SkillAgentId = 'claude' | 'codex' | 'gemini' | 'opencode' | 'hermes';
export type SkillAgentTone = 'orange' | 'green' | 'blue' | 'purple' | 'slate';

interface AgentLogoProps {
  agentId: SkillAgentId;
  className?: string;
  imageClassName?: string;
}

export const SKILL_AGENTS: Array<{
  id: SkillAgentId;
  label: string;
  tone: SkillAgentTone;
}> = [
  { id: 'claude', label: 'Claude', tone: 'orange' },
  { id: 'codex', label: 'Codex', tone: 'green' },
  { id: 'gemini', label: 'Gemini', tone: 'blue' },
  { id: 'opencode', label: 'OpenCode', tone: 'purple' },
  { id: 'hermes', label: 'Hermes', tone: 'slate' },
];

export function AgentLogo({ agentId, className, imageClassName }: AgentLogoProps) {
  const src = agentIconMap[agentId];

  return (
    <span
      className={cn(
        'inline-flex size-7 shrink-0 items-center justify-center rounded-[7px] border border-border bg-background shadow-sm',
        className,
      )}
      aria-hidden
    >
      <img src={src} alt="" className={cn('size-4', imageClassName)} draggable={false} />
    </span>
  );
}

const agentIconMap = {
  claude: claudeIcon,
  codex: codexIcon,
  gemini: geminiIcon,
  opencode: openCodeIcon,
  hermes: hermesIcon,
} satisfies Record<SkillAgentId, string>;
