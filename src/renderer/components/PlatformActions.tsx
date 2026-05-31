import { useTranslation } from 'react-i18next';
import { usePlatformStore } from '../stores';
import type { PlatformId } from '../types';

interface PlatformActionsProps {
  platform: PlatformId;
}

export default function PlatformActions({ platform }: PlatformActionsProps) {
  const { t } = useTranslation();
  const { capabilities, getActionsForPlatform } = usePlatformStore();

  const caps = capabilities.get(platform);
  const actions = getActionsForPlatform(platform);

  if (!caps) return null;

  const showExtensionInjection = caps.family === 'vscode' && caps.supportsExtensionInjection;
  const showCliAuth = caps.family === 'standalone';

  // Don't render if no actions available
  if (!showExtensionInjection && !showCliAuth && actions.length === 0) {
    return null;
  }

  return (
    <div className="card bg-base-200 shadow-sm">
      <div className="card-body p-4">
        <h3 className="card-title text-base">{t('platformActions.customActions')}</h3>

        <div className="flex flex-wrap gap-2 mt-2">
          {/* VS Code family: Extension injection */}
          {showExtensionInjection && (
            <button className="btn btn-outline btn-sm">
              🧩 {t('platformActions.extensionInjection')}
            </button>
          )}

          {/* Standalone family: CLI auth */}
          {showCliAuth && (
            <button className="btn btn-outline btn-sm">
              🔐 {t('platformActions.cliAuth')}
            </button>
          )}

          {/* Custom actions from platform capabilities */}
          {actions.map((action) => (
            <div
              key={action.id}
              className={action.disabled ? 'tooltip' : ''}
              data-tip={action.disabledReason}
            >
              <button
                className="btn btn-outline btn-sm"
                disabled={action.disabled}
              >
                {action.icon && <span>{action.icon}</span>}
                {action.label}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
