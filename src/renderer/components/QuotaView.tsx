import { useEffect, useState, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuotaStore, useAccountStore, useSettingsStore } from '../stores';
import type { PlatformId, QuotaInfo } from '../types';

interface QuotaViewProps {
  platform: PlatformId;
}

export default function QuotaView({ platform }: QuotaViewProps) {
  const { t } = useTranslation();
  const { quotas, errors, lastUpdated, loading, refreshQuota } = useQuotaStore();
  const { activeAccounts } = useAccountStore();
  const { refreshIntervals } = useSettingsStore();

  const [refreshing, setRefreshing] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const activeAccountId = activeAccounts.get(platform);
  const quotaInfo: QuotaInfo | undefined = activeAccountId
    ? quotas.get(activeAccountId)
    : undefined;
  const quotaError = activeAccountId ? errors.get(activeAccountId) : undefined;
  const lastUpdate = activeAccountId ? lastUpdated.get(activeAccountId) : undefined;

  // Auto-refresh interval
  const intervalMinutes = refreshIntervals.get(platform) ?? 5;

  // Setup auto-refresh timer
  useEffect(() => {
    if (!activeAccountId) return;

    const startTimer = () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(
        () => {
          refreshQuota(activeAccountId);
        },
        intervalMinutes * 60 * 1000
      );
    };

    startTimer();
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [activeAccountId, intervalMinutes, refreshQuota]);

  const handleRefresh = useCallback(async () => {
    if (!activeAccountId) return;
    setRefreshing(true);
    try {
      await refreshQuota(activeAccountId);
    } finally {
      setRefreshing(false);
    }
  }, [activeAccountId, refreshQuota]);

  // No active account
  if (!activeAccountId) {
    return null;
  }

  return (
    <div className="card bg-base-200 shadow-sm">
      <div className="card-body p-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h3 className="card-title text-base">{t('quota.title')}</h3>
          <div className="flex items-center gap-2">
            {lastUpdate && (
              <span className="text-xs text-base-content/50">
                {t('quota.lastUpdated')}: {lastUpdate.toLocaleTimeString()}
              </span>
            )}
            <button
              className={`btn btn-ghost btn-xs ${refreshing ? 'loading' : ''}`}
              onClick={handleRefresh}
              disabled={refreshing || loading}
            >
              {refreshing ? t('quota.refreshing') : t('quota.refresh')}
            </button>
          </div>
        </div>

        {/* Auto-refresh indicator */}
        <div className="text-xs text-base-content/40">
          {t('quota.autoRefresh')}: {intervalMinutes} {t('settings.refreshIntervalUnit')}
        </div>

        {/* Error state with fallback */}
        {quotaError && (
          <div className="alert alert-warning py-2 mt-2">
            <span className="text-sm">
              {t('quota.fetchFailed')}: {quotaError}
            </span>
          </div>
        )}

        {/* Quota data */}
        {quotaInfo && quotaInfo.models.length > 0 ? (
          <div className="space-y-3 mt-2">
            {quotaInfo.models.map((model) => {
              const remaining = model.total - model.used;
              return (
                <div key={model.modelName} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="font-medium">{model.modelName}</span>
                    <span
                      className={model.isWarning ? 'text-warning font-bold' : 'text-base-content/70'}
                    >
                      {model.usagePercentage}%
                    </span>
                  </div>
                  <progress
                    className={`progress w-full ${model.isWarning ? 'progress-warning' : 'progress-primary'}`}
                    value={model.usagePercentage}
                    max="100"
                  />
                  <div className="flex justify-between text-xs text-base-content/50">
                    <span>
                      {t('quota.used')}: {model.used} / {model.total}
                    </span>
                    <span>
                      {t('quota.remaining')}: {remaining}
                    </span>
                  </div>
                  {model.resetAt && (
                    <p className="text-xs text-base-content/40">
                      {t('quota.resetAt')}: {new Date(model.resetAt).toLocaleString()}
                    </p>
                  )}
                  {model.isWarning && (
                    <span className="badge badge-warning badge-sm">{t('quota.warning')}</span>
                  )}
                </div>
              );
            })}
          </div>
        ) : !quotaError ? (
          <p className="text-sm text-base-content/50 mt-2">{t('quota.noData')}</p>
        ) : null}
      </div>
    </div>
  );
}
