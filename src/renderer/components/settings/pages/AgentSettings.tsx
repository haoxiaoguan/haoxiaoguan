import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore, usePlatformStore } from '../../../stores';
import { settingsService } from '../../../services/tauri';
import { SettingsLayout } from '../SettingsLayout';
import type { PlatformId } from '../../../types';

const ALL_PLATFORMS: PlatformId[] = [
  'cursor', 'windsurf', 'kiro', 'github-copilot', 'codex',
  'gemini-cli', 'codebuddy', 'codebuddy-cn', 'qoder', 'trae', 'zed',
];

export default function AgentSettings() {
  const { t } = useTranslation();
  const { refreshIntervals, setRefreshInterval } = useSettingsStore();
  const { getDisplayName } = usePlatformStore();
  const [idePaths, setIdePaths] = useState<Record<string, string>>({});
  const [idePathValid, setIdePathValid] = useState<Record<string, boolean | null>>({});

  const handleRefreshIntervalChange = (platform: PlatformId, minutes: number) => {
    setRefreshInterval(platform, Math.max(2, Math.min(30, minutes)));
  };

  const handleIdePathSave = async (platform: PlatformId) => {
    const path = idePaths[platform];
    if (!path?.trim()) return;
    try {
      await settingsService.updateSettings({ settings: { [`ide_path_${platform}`]: path.trim() } });
      setIdePathValid((p) => ({ ...p, [platform]: true }));
    } catch {
      setIdePathValid((p) => ({ ...p, [platform]: false }));
    }
  };

  return (
    <SettingsLayout
      title={t('settings.agent.title', 'Agent')}
      description={t('settings.agent.desc', '配置各平台刷新频率与 IDE 可执行文件路径。')}
    >
      <section className="rounded-xl border border-border/70 bg-card p-5 space-y-4">
        {ALL_PLATFORMS.map((platform) => {
          const interval = refreshIntervals.get(platform) ?? 5;
          const idePath = idePaths[platform] ?? '';
          const pathValid = idePathValid[platform];
          return (
            <div key={platform} className="border-b border-border/40 pb-4 last:border-0">
              <h3 className="mb-2 text-sm font-medium">{getDisplayName(platform)}</h3>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <div className="mb-1 flex justify-between text-xs">
                    <span>{t('settings.refreshInterval')}</span>
                    <span>{interval} {t('settings.refreshIntervalUnit')}</span>
                  </div>
                  <input
                    type="range" min={2} max={30} value={interval}
                    className="range range-primary range-xs"
                    aria-label={`${getDisplayName(platform)} ${t('settings.refreshInterval')}`}
                    onChange={(e) => handleRefreshIntervalChange(platform, Number(e.target.value))}
                  />
                </div>
                <div>
                  <div className="mb-1 flex justify-between text-xs">
                    <span>{t('settings.idePath')}</span>
                    {pathValid === true && <span className="text-success">✓</span>}
                    {pathValid === false && <span className="text-error">✗</span>}
                  </div>
                  <input
                    type="text"
                    className={`input input-bordered input-sm w-full ${pathValid === false ? 'input-error' : ''}`}
                    placeholder={t('settings.idePathPlaceholder')}
                    aria-label={`${getDisplayName(platform)} ${t('settings.idePath')}`}
                    value={idePath}
                    onChange={(e) => setIdePaths((p) => ({ ...p, [platform]: e.target.value }))}
                    onBlur={() => { if (idePath.trim()) handleIdePathSave(platform); }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </section>
    </SettingsLayout>
  );
}
