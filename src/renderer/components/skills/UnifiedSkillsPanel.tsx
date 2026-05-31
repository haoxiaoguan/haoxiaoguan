import { useSearchParams } from 'react-router-dom';
import { InstalledSkillsList } from './InstalledSkillsList';
import { DiscoverSkillsList } from './DiscoverSkillsList';

type TabId = 'installed' | 'discover';

export function UnifiedSkillsPanel() {
  const [searchParams] = useSearchParams();
  const activeTab: TabId = searchParams.get('tab') === 'discover' ? 'discover' : 'installed';

  return (
    <div role="tabpanel" className="flex min-h-0 min-w-0 flex-1 flex-col">
      {activeTab === 'installed' && <InstalledSkillsList />}
      {activeTab === 'discover' && <DiscoverSkillsList />}
    </div>
  );
}
