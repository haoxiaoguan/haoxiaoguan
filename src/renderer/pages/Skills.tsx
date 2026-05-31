import { UnifiedSkillsPanel } from '../components/skills/UnifiedSkillsPanel';

export default function Skills() {
  return (
    <div className="flex h-[calc(100vh-98px)] min-h-0 flex-col overflow-hidden px-6 py-5">
      <UnifiedSkillsPanel />
    </div>
  );
}
