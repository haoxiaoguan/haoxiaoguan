import { useTranslation } from 'react-i18next';
import { useSkillsStore } from '../../stores/skillsStore';
import type { InstalledSkill } from '../../types';
import { AgentToggleRow } from './AgentToggleRow';

const SKILLS_AGENTS = ['claude', 'codex', 'gemini_cli', 'claude_desktop', 'gemini', 'opencode', 'hermes'];

interface SkillCardProps {
  skill: InstalledSkill;
}

export function SkillCard({ skill }: SkillCardProps) {
  const { t } = useTranslation();
  const { uninstallSkill, toggleApp } = useSkillsStore();

  const enabledCount = Object.values(skill.apps).filter(Boolean).length;

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <h3 className="font-medium text-sm truncate">{skill.name}</h3>
          {skill.description && (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{skill.description}</p>
          )}
        </div>
        <button
          type="button"
          className="text-xs text-destructive hover:text-destructive/80 ml-2 shrink-0"
          onClick={() => uninstallSkill(skill.id)}
        >
          {t('skills.uninstall', '卸载')}
        </button>
      </div>

      {/* 仓库信息 */}
      {skill.repo_owner && skill.repo_name && (
        <p className="text-xs text-muted-foreground">
          {skill.repo_owner}/{skill.repo_name}
        </p>
      )}

      {/* Agent 启用状态 */}
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">
          {t('skills.enabledAgents', '已启用')} ({enabledCount}/{SKILLS_AGENTS.length})
        </p>
        <div className="space-y-1">
          {SKILLS_AGENTS.map((agentId) => (
            <AgentToggleRow
              key={agentId}
              agentId={agentId}
              enabled={skill.apps[agentId] ?? false}
              onToggle={(enabled) => toggleApp(skill.id, agentId, enabled)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
