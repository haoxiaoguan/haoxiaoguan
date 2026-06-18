import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUpCircle, Check, Loader2, PackageCheck, Stethoscope, AlertTriangle, Download, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ClientLogo } from '@/components/clientConfig/ClientLogo';
import { ClientUpgradeConfirmDialog } from '@/components/clientConfig/ClientUpgradeConfirmDialog';
import { useClientConfigStore } from '../stores/clientConfigStore';
import type { ClientConfigClientId, ClientConfigInstallation, ClientConfigUpgradePlan } from '@shared/api-types';

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
    planUpgrade,
    upgrade,
    install,
    batchUpgrade,
    diagnose,
  } = useClientConfigStore();
  const [batching, setBatching] = useState(false);
  // 升级前规划进行中（probe 阶段，禁用按钮避免并发触发）。
  const [preparing, setPreparing] = useState(false);
  // 待确认的多处安装升级：plans=需确认的客户端规划，run=确认后实际执行的动作。
  const [pendingUpgrade, setPendingUpgrade] = useState<{
    plans: ClientConfigUpgradePlan[];
    run: () => Promise<void>;
  } | null>(null);

  const displayNameOf = (clientId: ClientConfigClientId): string =>
    clients.find((c) => c.clientId === clientId)?.displayName ?? clientId;

  useEffect(() => {
    if (clients.length === 0) void init();
    else void loadVersions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 版本尚未首次探测完成（避免顶部「全部升级」也先显示错计数再跳变）。
  const versionsPending = versionsLoading && Object.keys(versions).length === 0;
  const upgradableCount = clients.filter((c) => versions[c.clientId]?.upgradable === true).length;

  // 实际执行单个升级（已通过任何必要的确认后才调用）。
  const doUpgradeOne = async (clientId: ClientConfigClientId, name: string) => {
    const r = await upgrade(clientId);
    if (r.ok) toast.success(t('clientManage.upgradeSuccess', { client: name }));
    else toast.error(t('clientManage.upgradeFailed', { client: name }), { description: r.detail });
  };

  // 实际执行批量升级（已确认后才调用）。
  const doBatch = async () => {
    setBatching(true);
    try {
      const { done, failed } = await batchUpgrade();
      if (failed === 0) toast.success(t('clientManage.batchDone', { done, failed }));
      else toast.error(t('clientManage.batchDone', { done, failed }));
    } finally {
      setBatching(false);
    }
  };

  /**
   * 升级前先规划（对称 cc-switch）：对每个目标客户端探测安装分布；任一存在多处安装（needsConfirmation）
   * 就弹窗让用户知情「升级只动命令行默认那处」后再执行；否则直接执行。规划失败不阻断，退回直接执行。
   */
  const requestUpgrade = async (ids: ClientConfigClientId[], run: () => Promise<void>) => {
    if (ids.length === 0 || preparing || batching) return;
    setPreparing(true);
    try {
      const plans = await Promise.all(ids.map((id) => planUpgrade(id)));
      const needConfirm = plans.filter((p) => p.needsConfirmation);
      if (needConfirm.length === 0) {
        await run();
        return;
      }
      setPendingUpgrade({ plans: needConfirm, run });
    } catch {
      await run();
    } finally {
      setPreparing(false);
    }
  };

  const onUpgradeOne = (clientId: ClientConfigClientId, name: string) =>
    requestUpgrade([clientId], () => doUpgradeOne(clientId, name));

  const onConfirmUpgrade = async () => {
    const p = pendingUpgrade;
    setPendingUpgrade(null);
    if (p) await p.run();
  };

  const onInstallOne = async (clientId: ClientConfigClientId, name: string) => {
    const r = await install(clientId);
    if (r.ok) toast.success(t('clientManage.installSuccess', { client: name }));
    else toast.error(t('clientManage.installFailed', { client: name }), { description: r.detail });
  };

  const onCopyCommand = async (command: string) => {
    try {
      await navigator.clipboard.writeText(command);
      toast.success(t('clientManage.copied'));
    } catch {
      toast.error(t('clientManage.copyFailed'));
    }
  };

  const onBatch = () => {
    const ids = clients.filter((c) => versions[c.clientId]?.upgradable === true).map((c) => c.clientId);
    return requestUpgrade(ids, doBatch);
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
          disabled={batching || preparing || versionsPending || upgradableCount === 0}
          onClick={() => void onBatch()}
        >
          {batching || preparing || versionsPending ? (
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
          const notInstalled = !c.detected && installed === undefined;
          const isBusy = upgradingClient === c.clientId;
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
                {/* 未安装：自动安装 + 复制手动安装命令 */}
                {!pending && notInstalled && (
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button
                      size="sm"
                      className="h-8 gap-1.5 text-[12px]"
                      disabled={isBusy || batching || preparing}
                      onClick={() => void onInstallOne(c.clientId, c.displayName)}
                    >
                      {isBusy ? (
                        <>
                          <Loader2 className="size-3.5 animate-spin" aria-hidden />
                          {t('clientManage.installing')}
                        </>
                      ) : (
                        <>
                          <Download className="size-3.5" aria-hidden />
                          {t('clientManage.install')}
                        </>
                      )}
                    </Button>
                    {v?.installCommand !== undefined && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-8"
                        disabled={isBusy}
                        title={t('clientManage.copyInstallHint', { command: v.installCommand })}
                        aria-label={t('clientManage.copyInstall')}
                        onClick={() => void onCopyCommand(v.installCommand as string)}
                      >
                        <Copy className="size-3.5" aria-hidden />
                      </Button>
                    )}
                  </div>
                )}
                {!pending && !notInstalled && upgradable && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 shrink-0 gap-1.5 border-amber-500/50 text-[12px] text-amber-600 hover:border-amber-500 hover:bg-amber-500/10 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300"
                    disabled={isBusy || batching || preparing}
                    onClick={() => void onUpgradeOne(c.clientId, c.displayName)}
                  >
                    {isBusy ? (
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
                {!pending && !notInstalled && !upgradable && installed !== undefined && v?.latestVersion !== undefined && !broken && (
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

      <ClientUpgradeConfirmDialog
        open={pendingUpgrade !== null}
        plans={pendingUpgrade?.plans ?? []}
        displayName={displayNameOf}
        onConfirm={() => void onConfirmUpgrade()}
        onCancel={() => setPendingUpgrade(null)}
      />
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
