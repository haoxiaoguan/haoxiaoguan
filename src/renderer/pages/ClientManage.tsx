import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUpCircle, Check, Loader2, PackageCheck, Stethoscope, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ClientLogo } from '@/components/clientConfig/ClientLogo';
import { useClientConfigStore } from '../stores/clientConfigStore';
import type { ClientConfigClientId, ClientConfigInstallation } from '@shared/api-types';

/**
 * 客户端管理页（客户端接入下的子 tab）：探测各 AI 客户端 CLI 的安装版本，
 * 单个/批量升级到最新，并诊断同一命令的多处安装冲突。版本/升级复用 clientConfigStore。
 */
export default function ClientManage() {
  const { t } = useTranslation('nav');
  const {
    clients,
    versions,
    versionsLoading,
    upgradingClient,
    reports,
    diagnosing,
    init,
    loadVersions,
    upgrade,
    batchUpgrade,
    diagnose,
  } = useClientConfigStore();
  const [batching, setBatching] = useState(false);

  useEffect(() => {
    if (clients.length === 0) void init();
    else void loadVersions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 版本尚未首次探测完成（避免顶部「全部升级」也先显示错计数再跳变）。
  const versionsPending = versionsLoading && Object.keys(versions).length === 0;
  const upgradableCount = clients.filter((c) => versions[c.clientId]?.upgradable === true).length;

  const onUpgradeOne = async (clientId: ClientConfigClientId, name: string) => {
    const r = await upgrade(clientId);
    if (r.ok) toast.success(t('clientManage.upgradeSuccess', { client: name }));
    else toast.error(t('clientManage.upgradeFailed', { client: name }), { description: r.detail });
  };

  const onBatch = async () => {
    setBatching(true);
    try {
      const { done, failed } = await batchUpgrade();
      if (failed === 0) toast.success(t('clientManage.batchDone', { done, failed }));
      else toast.error(t('clientManage.batchDone', { done, failed }));
    } finally {
      setBatching(false);
    }
  };

  const onDiagnose = async () => {
    await diagnose();
    const conflicts = Object.values(useClientConfigStore.getState().reports).filter((r) => r.isConflict).length;
    if (conflicts === 0) toast.success(t('clientManage.diagnoseClean'));
    else toast.warning(t('clientManage.diagnoseFound', { count: conflicts }));
  };

  return (
    <div className="flex flex-col gap-5 px-6 py-5">
      {/* 头部 */}
      <div className="flex items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-[9px] bg-primary/10">
          <PackageCheck className="size-[18px] text-primary" strokeWidth={1.9} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold leading-5 text-foreground">{t('clientManage.title')}</div>
          <div className="mt-0.5 text-[12px] text-muted-foreground">{t('clientManage.subtitle')}</div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-[12px]"
          disabled={diagnosing}
          onClick={() => void onDiagnose()}
        >
          {diagnosing ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Stethoscope className="size-3.5" aria-hidden />}
          {diagnosing ? t('clientManage.diagnosing') : t('clientManage.diagnose')}
        </Button>
        <Button
          size="sm"
          className="h-8 gap-1.5 text-[12px]"
          disabled={batching || versionsPending || upgradableCount === 0}
          onClick={() => void onBatch()}
        >
          {batching || versionsPending ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <ArrowUpCircle className="size-3.5" aria-hidden />
          )}
          {versionsPending
            ? t('clientManage.detecting')
            : upgradableCount > 0
              ? t('clientManage.batchUpgrade', { count: upgradableCount })
              : t('clientManage.batchUpgradeNone')}
        </Button>
      </div>

      {/* 客户端版本卡片 */}
      <div className="flex flex-col gap-2.5">
        {clients.map((c) => {
          const v = versions[c.clientId];
          const report = reports[c.clientId];
          const installed = v?.installedVersion;
          const upgradable = v?.upgradable === true;
          const broken = v?.installedButBroken === true;
          const isUpgrading = upgradingClient === c.clientId;
          // 版本未探测完成前用 loading 占位，避免先显示「已安装」再跳变成「可升级/已是最新」。
          const pending = versionsLoading && v === undefined;

          let statusText: string;
          let statusTone: string;
          if (!c.detected && installed === undefined) {
            statusText = t('clientManage.statusNotInstalled');
            statusTone = 'bg-zinc-400/15 text-zinc-500 dark:text-zinc-400';
          } else if (broken) {
            statusText = t('clientManage.statusBroken');
            statusTone = 'bg-red-500/15 text-red-600 dark:text-red-400';
          } else if (upgradable) {
            statusText = t('clientManage.statusUpgradable');
            statusTone = 'bg-amber-500/15 text-amber-600 dark:text-amber-400';
          } else if (installed !== undefined && v?.latestVersion !== undefined) {
            statusText = t('clientManage.statusUpToDate');
            statusTone = 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400';
          } else {
            statusText = t('clientManage.statusInstalled');
            statusTone = 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400';
          }

          return (
            <div key={c.clientId} className="rounded-[10px] border border-border/60 bg-card">
              <div className="flex items-center gap-3 p-3.5">
                <ClientLogo clientId={c.clientId} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-medium text-foreground">{c.displayName}</span>
                    {pending ? (
                      <span className="h-4 w-12 shrink-0 animate-pulse rounded-[6px] bg-muted" aria-hidden />
                    ) : (
                      <span className={cn('shrink-0 rounded-[6px] px-1.5 py-0.5 text-[10px] font-medium', statusTone)}>
                        {statusText}
                      </span>
                    )}
                  </div>
                  {pending ? (
                    <div className="mt-1 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                      <Loader2 className="size-3 animate-spin" aria-hidden />
                      {t('clientManage.detecting')}
                    </div>
                  ) : (
                    <div className="mt-0.5 truncate text-[11.5px] tabular-nums text-muted-foreground">
                      {installed !== undefined
                        ? t('clientManage.current', { version: installed })
                        : t('clientManage.statusNotInstalled')}
                      {v?.latestVersion !== undefined ? ` · ${t('clientManage.latest', { version: v.latestVersion })}` : ''}
                    </div>
                  )}
                </div>
                {!pending && upgradable && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 shrink-0 gap-1.5 border-amber-500/50 text-[12px] text-amber-600 hover:border-amber-500 hover:bg-amber-500/10 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300"
                    disabled={isUpgrading || batching}
                    onClick={() => void onUpgradeOne(c.clientId, c.displayName)}
                  >
                    {isUpgrading ? (
                      <>
                        <Loader2 className="size-3.5 animate-spin" aria-hidden />
                        {t('clientManage.upgrading')}
                      </>
                    ) : (
                      <>
                        <ArrowUpCircle className="size-3.5" aria-hidden />
                        {t('clientManage.upgradeTo', { latest: v?.latestVersion ?? '' })}
                      </>
                    )}
                  </Button>
                )}
                {!pending && !upgradable && installed !== undefined && v?.latestVersion !== undefined && !broken && (
                  <span className="flex shrink-0 items-center gap-1 text-[11.5px] text-emerald-600 dark:text-emerald-400">
                    <Check className="size-3.5" aria-hidden />
                    {t('clientManage.statusUpToDate')}
                  </span>
                )}
              </div>

              {/* 多处安装冲突（诊断后才有） */}
              {report?.isConflict === true && (
                <div className="border-t border-border/60 px-3.5 py-2.5">
                  <div className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-medium text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="size-3.5" aria-hidden />
                    {t('clientManage.conflictTitle')}
                  </div>
                  <div className="flex flex-col gap-1">
                    {report.installs.map((inst) => (
                      <InstallRow key={inst.path} inst={inst} t={t} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function InstallRow({
  inst,
  t,
}: {
  inst: ClientConfigInstallation;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      {inst.isPathDefault && (
        <span className="shrink-0 rounded-[5px] bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
          {t('clientManage.pathDefault')}
        </span>
      )}
      <span className="shrink-0 rounded-[5px] bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{inst.source}</span>
      <span className="shrink-0 tabular-nums text-foreground">
        {inst.version !== undefined ? `v${inst.version}` : t('clientManage.notRunnable')}
      </span>
      <span className="truncate font-mono text-[10.5px] text-muted-foreground">{inst.path}</span>
    </div>
  );
}
