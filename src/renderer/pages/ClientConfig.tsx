import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, History, Trash2, Check, Star, Copy, Pencil, Wifi } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { useClientConfigStore } from '../stores/clientConfigStore';
import { useSettingsStore } from '../stores/settingsStore';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ClientLogo } from '@/components/clientConfig/ClientLogo';
import { clientStatus } from '@/components/clientConfig/clientStatus';
import { ProviderBrandIcon } from '@/components/clientConfig/ProviderBrandIcon';
import { AddProviderDialog } from '@/components/clientConfig/AddProviderDialog';
import { EditProviderDialog } from '@/components/clientConfig/EditProviderDialog';
import { CodexSwitchRepairDialog } from '@/components/clientConfig/CodexSwitchRepairDialog';
import { CLIENT_NATIVE_PROTOCOL_UI } from '@/components/clientConfig/provider-templates';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import type {
  ClientConfigProfileDto,
  ClientConfigSnapshotDto,
  UpdateClientConfigProfileDto,
  CodexRepairProgressDto,
} from '@shared/api-types';
import { sessionsService } from '@/services/tauri';

/** 该供应商是否「需要中转」：固定协议客户端 + manual 档 + 上游协议 ≠ 客户端原生协议。
 *  flexible 客户端(无原生协议表)永远直连，不需要中转。 */
function providerNeedsRelay(p: ClientConfigProfileDto): boolean {
  if (p.source !== 'manual') return false;
  const native = CLIENT_NATIVE_PROTOCOL_UI[p.clientId];
  if (native === undefined) return false;
  const proto = p.settings?.upstreamProtocol;
  return typeof proto === 'string' && proto.length > 0 && proto !== native;
}

// ─── 图标工具按钮 + tooltip ──────────────────────────────────────────────
function IconAction({
  icon: Icon,
  label,
  onClick,
  disabled,
  danger,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          disabled={disabled}
          aria-label={label}
          onClick={onClick}
          className={cn('size-7 text-muted-foreground', danger && 'hover:text-destructive')}
        >
          <Icon className="size-3.5" aria-hidden />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

// ─── 历史 / 回滚弹窗 ──────────────────────────────────────────────────────
function HistoryDialog({
  entries,
  onRollback,
  onClose,
}: {
  entries: ClientConfigSnapshotDto[] | null;
  onRollback: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation('nav');
  return (
    <Dialog open={entries !== null} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('clientConfigPage.historyDialog.title')}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[50vh] space-y-1.5 overflow-y-auto">
          {(entries ?? []).length === 0 ? (
            <div className="py-6 text-center text-[12px] text-muted-foreground/60">
              {t('clientConfigPage.historyDialog.empty')}
            </div>
          ) : (
            (entries ?? []).map((e) => (
              <div key={e.id} className="flex items-center gap-2 rounded-[8px] border border-border/60 px-3 py-2">
                <span className="flex-1 truncate text-[12px]">
                  <span className="font-medium">{e.action}</span>
                  <span className="ml-2 text-muted-foreground">{new Date(e.tsMs).toLocaleString()}</span>
                </span>
                <Button size="sm" variant="ghost" className="h-7 text-[12px]" onClick={() => onRollback(e.id)}>
                  {t('clientConfigPage.historyDialog.rollback')}
                </Button>
              </div>
            ))
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('clientConfigPage.historyDialog.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── 单份接入档行（切换/累加差异化）──────────────────────────────────────
function ProviderRow({
  p,
  isAdditive,
  loading,
  routingOn,
  onTestConn,
  onApply,
  onClear,
  onEnable,
  onDisable,
  onSetDefault,
  onEdit,
  onDuplicate,
  onRemove,
}: {
  p: ClientConfigProfileDto;
  isAdditive: boolean;
  loading: boolean;
  /** 该客户端「路由」开关是否开启（用于匹配档显示「经路由」标识）。 */
  routingOn: boolean;
  onTestConn: (id: string) => void;
  onApply: (id: string) => void;
  onClear: (id: string) => void;
  onEnable: (id: string) => void;
  onDisable: (id: string) => void;
  onSetDefault: (id: string) => void;
  onEdit: (p: ClientConfigProfileDto) => void;
  onDuplicate: (p: ClientConfigProfileDto) => void;
  onRemove: (id: string) => void;
}) {
  const { t } = useTranslation('nav');
  // 高亮：切换式看 isCurrent，累加式看 enabled。
  const active = isAdditive ? p.enabled : p.isCurrent;
  // 品牌图标元数据(添加时写入 settings.uiMeta);本机反代档用主题色「号」标识。
  const uiMeta = (p.settings?.uiMeta ?? {}) as { icon?: string; iconColor?: string };
  const isLocal = p.source === 'local-proxy';
  const iconName = isLocal ? '号小管' : p.name;
  return (
    <div className={cn('flex items-center gap-3 rounded-[8px] border px-4 py-3', active ? 'border-primary/50 bg-primary/[0.04]' : 'border-border/60')}>
      <ProviderBrandIcon
        icon={isLocal ? undefined : uiMeta.icon}
        iconColor={isLocal ? 'hsl(var(--primary))' : uiMeta.iconColor}
        name={iconName}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-[13px] font-medium text-foreground">
            {isLocal ? t('clientConfigPage.accountProvider') : p.name}
          </span>
          {!isAdditive && p.isCurrent && (
            <span className="inline-flex h-5 items-center gap-1 rounded-[6px] bg-primary/10 px-1.5 text-[10px] font-medium text-primary">
              <Check className="size-3" aria-hidden />
              {t('clientConfigPage.current')}
            </span>
          )}
          {isAdditive && p.enabled && (
            <span className="inline-flex h-5 items-center gap-1 rounded-[6px] bg-emerald-500/10 px-1.5 text-[10px] font-medium text-emerald-600">
              <Check className="size-3" aria-hidden />
              {t('clientConfigPage.injected')}
            </span>
          )}
          {isAdditive && p.isDefault && (
            <span className="inline-flex h-5 items-center gap-1 rounded-[6px] bg-amber-500/10 px-1.5 text-[10px] font-medium text-amber-600">
              <Star className="size-3" aria-hidden />
              {t('clientConfigPage.default')}
            </span>
          )}
          {p.source === 'local-proxy' ? (
            <span className="rounded-[6px] bg-muted px-1.5 text-[10px] text-muted-foreground">
              {t('clientConfigPage.sourceLocal')}
            </span>
          ) : providerNeedsRelay(p) ? (
            <span className="rounded-[6px] bg-amber-500/15 px-1.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
              {t('clientConfigPage.needsRelay')}
            </span>
          ) : routingOn ? (
            <span className="rounded-[6px] bg-primary/10 px-1.5 text-[10px] font-medium text-primary">
              {t('clientConfigPage.routed')}
            </span>
          ) : (
            <span className="rounded-[6px] bg-muted px-1.5 text-[10px] text-muted-foreground">
              {t('clientConfigPage.sourceDirect')}
            </span>
          )}
        </div>
        <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
          {p.baseUrl}
          {p.model ? ` · ${p.model}` : ''}
        </div>
      </div>
      <TooltipProvider delayDuration={200}>
        <div className="flex items-center gap-0.5">
          {/* 主操作前置:仅「启用 / 使用中」用文字按钮显示;点击在启用↔停用/还原间切换。 */}
          <Button
            size="sm"
            disabled={loading}
            variant={active ? 'outline' : 'default'}
            className="mr-1 h-7 gap-1 px-2.5 text-[12px]"
            onClick={() => {
              if (active) {
                if (isAdditive) onDisable(p.id);
                else onClear(p.id);
              } else {
                if (isAdditive) onEnable(p.id);
                else onApply(p.id);
              }
            }}
          >
            {active && <Check className="size-3.5" aria-hidden />}
            {active ? t('clientConfigPage.inUse') : t('clientConfigPage.enable')}
          </Button>
          <IconAction icon={Wifi} label={t('clientConfigPage.testConn')} disabled={loading} onClick={() => onTestConn(p.id)} />
          {isAdditive && p.enabled && !p.isDefault && (
            <IconAction icon={Star} label={t('clientConfigPage.setDefault')} disabled={loading} onClick={() => onSetDefault(p.id)} />
          )}
          {p.source === 'manual' && (
            <>
              <IconAction icon={Pencil} label={t('clientConfigPage.edit')} disabled={loading} onClick={() => onEdit(p)} />
              <IconAction icon={Copy} label={t('clientConfigPage.duplicate')} disabled={loading} onClick={() => onDuplicate(p)} />
            </>
          )}
          <IconAction icon={Trash2} label={t('clientConfigPage.delete')} danger disabled={loading} onClick={() => onRemove(p.id)} />
        </div>
      </TooltipProvider>
    </div>
  );
}

// ─── 号小管账号占位卡片（未接入时）：点启用 = 接入本机反代（账号额度反代）───────────
function AccountPlaceholderCard({ onConnect, loading }: { onConnect: () => void; loading: boolean }) {
  const { t } = useTranslation('nav');
  return (
    <div className="flex items-center gap-3 rounded-[8px] border border-dashed border-primary/40 bg-primary/[0.03] px-4 py-3">
      <ProviderBrandIcon iconColor="hsl(var(--primary))" name="号小管" />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-foreground">{t('clientConfigPage.accountProvider')}</div>
        <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{t('clientConfigPage.accountProviderHint')}</div>
      </div>
      <Button size="sm" disabled={loading} className="h-7 text-[12px]" onClick={onConnect}>
        {t('clientConfigPage.enable')}
      </Button>
    </div>
  );
}

// ─── 主页面（主从布局：左客户端 / 右供应商列表）─────────────────────────────
export default function ClientConfig() {
  const { t } = useTranslation('nav');
  const store = useClientConfigStore();
  const { clients, activeClient, profiles, counts, versions, error, loading } = store;
  const routingEnabled = useSettingsStore((s) => s.routingEnabled);
  const setRoutingEnabled = useSettingsStore((s) => s.setRoutingEnabled);
  const loadSettings = useSettingsStore((s) => s.loadSettings);
  // 右侧视图:列表 / 添加(页面) / 编辑(页面)。添加/编辑作为页面渲染在右侧,带返回。
  const [view, setView] = useState<
    { mode: 'list' } | { mode: 'add' } | { mode: 'edit'; profile: ClientConfigProfileDto }
  >({ mode: 'list' });
  const [historyData, setHistoryData] = useState<ClientConfigSnapshotDto[] | null>(null);
  // Codex 切换确认弹窗状态。action=enable（启用某档，迁会话到它）/ disable（停用某档，切回 OpenAI、迁会话过去）。
  const [codexSwitch, setCodexSwitch] = useState<{ id: string; name: string; action: 'enable' | 'disable' } | null>(null);
  const [codexSwitchBusy, setCodexSwitchBusy] = useState(false);
  const [codexSwitchProgress, setCodexSwitchProgress] = useState<CodexRepairProgressDto | null>(null);
  // 「需要中转」确认弹窗：启用协议不匹配的供应商但「路由」未开时弹出（硬门槛：不开就用不了）。
  const [needRelay, setNeedRelay] = useState<{ id: string; name: string; proto: string; native: string } | null>(null);

  useEffect(() => {
    void store.init();
    void loadSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (error) toast.error(error);
  }, [error]);

  const activeInfo = clients.find((c) => c.clientId === activeClient);
  const isAdditive = activeInfo?.writeMode === 'additive';
  // 「路由」开关仅固定协议客户端(claude/codex/gemini_cli)显示；flexible 客户端恒直连无需中转。
  const showRouting = CLIENT_NATIVE_PROTOCOL_UI[activeClient] !== undefined;
  const routingOnActive = routingEnabled[activeClient] === true;

  const onClear = async (id: string) => {
    await store.clear(id);
    toast.success(t('clientConfigPage.cleared'));
  };
  const onShowHistory = async () => {
    setHistoryData(await store.history());
  };
  const onRollback = async (entryId: string) => {
    await store.rollback(entryId);
    setHistoryData(null);
    toast.success(t('clientConfigPage.rolledBack'));
  };
  const onConnectLocalProxy = async () => {
    await store.connectLocalProxy();
    if (!useClientConfigStore.getState().error) toast.success(t('clientConfigPage.connected'));
  };
  const onTestConn = async (id: string) => {
    const r = await store.testConnectivity(id);
    if (r?.ok) toast.success(t('clientConfigPage.connOk'));
    else toast.error(t('clientConfigPage.connFail', { msg: r?.message ?? String(r?.status ?? '') }));
  };
  // 「路由」开关（按客户端，仅固定协议客户端显示）：持久化设置 + 按新形态重注入当前生效供应商。
  const onToggleRouting = async (v: boolean) => {
    if (!v) {
      // 关闭守卫：当前生效档若协议不匹配，需保持路由开启，否则用不了（硬门槛）。
      const active = profiles.find((p) => (isAdditive ? p.enabled : p.isCurrent));
      if (active && providerNeedsRelay(active)) {
        toast.error(t('clientConfigPage.routingOffBlocked'));
        return;
      }
    }
    await setRoutingEnabled(activeClient, v);
    await store.setRouting(activeClient, v);
    if (!useClientConfigStore.getState().error) {
      toast.success(v ? t('clientConfigPage.applied') : t('clientConfigPage.cleared'));
    }
  };

  // 「需要中转」硬门槛：启用协议不匹配的供应商但其客户端「路由」未开 → 拦下并弹确认。返回 true=已拦截。
  const relayGate = (id: string): boolean => {
    const p = profiles.find((x) => x.id === id);
    if (!p || !providerNeedsRelay(p)) return false;
    if (useSettingsStore.getState().routingEnabled[p.clientId] === true) return false;
    setNeedRelay({
      id,
      name: p.source === 'local-proxy' ? t('clientConfigPage.accountProvider') : p.name,
      proto: (p.settings?.upstreamProtocol as string) ?? '',
      native: CLIENT_NATIVE_PROTOCOL_UI[p.clientId] ?? '',
    });
    return true;
  };

  // 确认弹窗：开启该客户端「路由」(仅持久化设置，不在此重 apply 以免多余重启) → 随后照常启用本档。
  const confirmNeedRelay = async () => {
    if (!needRelay) return;
    const { id } = needRelay;
    const p = profiles.find((x) => x.id === id);
    setNeedRelay(null);
    if (!p) return;
    await setRoutingEnabled(p.clientId, true);
    if (isAdditive) await onEnable(id);
    else await onApply(id);
  };
  // Codex 切换确认后执行：启用/停用接入档 + 可选会话迁移。
  // 勾选迁移时走 main 编排 codexSwitchRepair——写配置 + 迁会话合并为「单次 Codex 重启」；
  // 不勾选时仅写配置（enable/disable 各自一次重启）。
  const doCodexSwitch = async (repairToo: boolean) => {
    if (!codexSwitch) return;
    const { id, action } = codexSwitch;
    setCodexSwitchBusy(true);
    setCodexSwitchProgress(null);
    let unsub: (() => void) | null = null;
    try {
      if (repairToo) {
        // 单次停-启：先关 Codex → 写配置(enable/disable) → 迁会话 → 启 Codex（main 内编排）。
        unsub = sessionsService.onRepairProgress((p) => setCodexSwitchProgress(p));
        const result = await sessionsService.codexSwitchRepair({ id, action });
        await store.init(); // IPC 直接写盘，刷新渲染层接入档启用/默认态
        toast.success(
          result ? t('clientConfigPage.codexSwitchDone', { n: result.updatedThreads }) : t('clientConfigPage.applied'),
        );
      } else {
        // 不迁移会话：仅写配置。
        if (action === 'enable') await store.enable(id);
        else await store.disable(id);
        if (useClientConfigStore.getState().error) {
          toast.error(useClientConfigStore.getState().error ?? t('clientConfigPage.connFail', { msg: '' }));
          return;
        }
        toast.success(action === 'enable' ? t('clientConfigPage.applied') : t('clientConfigPage.cleared'));
      }
      setCodexSwitch(null);
    } catch (e) {
      toast.error(String(e));
    } finally {
      unsub?.();
      setCodexSwitchBusy(false);
      setCodexSwitchProgress(null);
    }
  };

  // 启停供应商。Codex 为单选语义(enable 内部已委托：清掉其它+按中转注入模式注入所选)；其余客户端常规。
  // Codex additive 模式下，启用前弹确认框；其余直接 enable。
  // 应用（switch 客户端：写选中档并设当前生效）。协议不匹配且未开路由 → 先弹「需要中转」确认。
  const onApply = async (id: string) => {
    if (relayGate(id)) return;
    await store.apply(id);
    if (!useClientConfigStore.getState().error) toast.success(t('clientConfigPage.applied'));
  };
  const onEnable = async (id: string) => {
    if (relayGate(id)) return;
    if (activeClient === 'codex' && isAdditive) {
      // 找到对应 profile 拿名称
      const profile = profiles.find((p) => p.id === id);
      const name = profile
        ? profile.source === 'local-proxy'
          ? t('clientConfigPage.accountProvider')
          : profile.name
        : id;
      setCodexSwitch({ id, name, action: 'enable' });
      return;
    }
    await store.enable(id);
    toast.success(t('clientConfigPage.applied'));
  };
  const onDisable = async (id: string) => {
    // 停用当前默认 codex 接入档：停用后 model_provider 回落内置 openai，该档建的旧会话会被孤立看不见。
    // 故先弹确认（是否同时把会话迁到 OpenAI），与启用对称、单次重启。非默认/非 codex 直接停用。
    const profile = profiles.find((p) => p.id === id);
    const isDefaultCodex = activeClient === 'codex' && isAdditive && profile?.isDefault === true;
    if (isDefaultCodex) {
      const name = profile?.source === 'local-proxy' ? t('clientConfigPage.accountProvider') : (profile?.name ?? id);
      setCodexSwitch({ id, name, action: 'disable' });
      return;
    }
    await store.disable(id);
    toast.success(t('clientConfigPage.cleared'));
  };
  const onSetDefault = async (id: string) => {
    await store.setDefault(id);
    toast.success(t('clientConfigPage.defaultSet'));
  };
  const onDuplicate = async (p: ClientConfigProfileDto) => {
    const newName = `${p.name} ${t('clientConfigPage.copySuffix')}`;
    // 复制不带 apiKey(密钥需用户在编辑里重填);settings 含 uiMeta 品牌图标一并复制。
    await store.create({
      clientId: p.clientId,
      name: newName,
      source: 'manual',
      baseUrl: p.baseUrl,
      ...(p.model ? { model: p.model } : {}),
      ...(p.settings ? { settings: p.settings } : {}),
    });
    if (!useClientConfigStore.getState().error) toast.success(newName);
  };

  // 号小管账号(账号额度反代)= local-proxy 档,固定置顶;第三方 = manual 档。
  const accountProfile = profiles.find((p) => p.source === 'local-proxy');
  const thirdParty = profiles.filter((p) => p.source === 'manual');

  const onCreateProvider = async (v: { name: string; baseUrl: string; apiKey: string; model: string; settings?: Record<string, unknown> }) => {
    await store.create({
      clientId: activeClient,
      name: v.name,
      source: 'manual',
      baseUrl: v.baseUrl,
      ...(v.apiKey ? { apiKey: v.apiKey } : {}),
      ...(v.model ? { model: v.model } : {}),
      ...(v.settings ? { settings: v.settings } : {}),
    });
  };
  const onSaveProvider = async (id: string, patch: UpdateClientConfigProfileDto) => {
    await store.update(id, patch);
    if (!useClientConfigStore.getState().error) toast.success(t('clientConfigPage.form.save'));
  };

  return (
    <div className="flex h-[calc(100vh-96px)] w-full max-w-full min-w-0 overflow-hidden bg-card">
      {/* 左：客户端列表 */}
      <aside className="flex h-full min-h-0 w-[200px] shrink-0 flex-col border-r border-border/80 px-3 py-4">
        <div className="px-1 text-[12px] font-medium text-foreground/70">{t('clientConfigPage.clients')}</div>
        <ScrollArea className="mt-2 min-h-0 flex-1 pr-1">
          <nav className="flex min-w-0 flex-col gap-1" aria-label={t('clientConfigPage.clients')}>
            {clients.map((c) => {
              const selected = c.clientId === activeClient;
              const n = counts[c.clientId] ?? 0;
              const status = clientStatus(c.detected, versions[c.clientId], t);
              return (
                <button
                  key={c.clientId}
                  type="button"
                  onClick={() => {
                    setView({ mode: 'list' });
                    void store.selectClient(c.clientId);
                  }}
                  className={cn(
                    'flex h-11 w-full min-w-0 items-center gap-2.5 rounded-[8px] px-2 text-left transition-colors',
                    selected ? 'bg-primary/10' : 'hover:bg-muted',
                  )}
                >
                  <ClientLogo clientId={c.clientId} />
                  <span className="min-w-0 flex-1">
                    <span className={cn('block truncate text-[12.5px] font-medium', selected ? 'text-primary' : 'text-foreground')}>
                      {c.displayName}
                    </span>
                    <span className="flex items-center gap-1 text-[10px] text-muted-foreground" title={status.title}>
                      <span className={cn('size-1.5 rounded-full', status.dotClass)} aria-hidden />
                      {status.label}
                    </span>
                  </span>
                  {n > 0 && (
                    <span className="shrink-0 rounded-[6px] bg-muted px-1.5 text-[10px] text-muted-foreground">{n}</span>
                  )}
                </button>
              );
            })}
          </nav>
        </ScrollArea>
      </aside>

      {/* 右：供应商列表 / 添加 / 编辑(页面) */}
      <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {view.mode === 'add' ? (
          <AddProviderDialog
            clientId={activeClient}
            clientName={activeInfo?.displayName ?? ''}
            onBack={() => setView({ mode: 'list' })}
            onCreate={onCreateProvider}
          />
        ) : view.mode === 'edit' ? (
          <EditProviderDialog
            profile={view.profile}
            onBack={() => setView({ mode: 'list' })}
            onSave={onSaveProvider}
          />
        ) : (
          <>
        <div className="flex min-w-0 items-center gap-2.5 border-b border-border/60 px-5 py-3.5">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-[14px] font-semibold text-foreground">{activeInfo?.displayName ?? ''}</span>
              <span className="shrink-0 rounded-[6px] bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {isAdditive ? t('clientConfigPage.coexist') : t('clientConfigPage.switchMode')}
              </span>
            </div>
            <div className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
              {isAdditive ? t('clientConfigPage.coexistHint') : t('clientConfigPage.switchHint')}
            </div>
          </div>
          <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-[12px]" onClick={() => void onShowHistory()}>
            <History className="size-3.5" aria-hidden />
            {t('clientConfigPage.history')}
          </Button>
          {/* 「路由」开关（固定协议客户端 claude/codex/gemini）：开=第三方供应商经号小管反代转发。
              协议不匹配的供应商必须开启才能用。提示用项目 Tooltip 组件(样式统一)。 */}
          {showRouting && (
            <Tooltip>
              <TooltipTrigger asChild>
                <label className="flex h-8 shrink-0 items-center gap-1.5 rounded-[8px] border border-border/60 px-2.5">
                  <span className="text-[12px] text-muted-foreground">{t('clientConfigPage.routing')}</span>
                  <Switch
                    checked={routingOnActive}
                    onCheckedChange={(v) => void onToggleRouting(v)}
                    aria-label={t('clientConfigPage.routing')}
                  />
                </label>
              </TooltipTrigger>
              <TooltipContent className="max-w-[260px] leading-relaxed">
                {t('clientConfigPage.routingHint')}
              </TooltipContent>
            </Tooltip>
          )}
          <Button size="sm" className="h-8 gap-1.5 text-[12px]" onClick={() => setView({ mode: 'add' })}>
            <Plus className="size-3.5" aria-hidden />
            {t('clientConfigPage.addProfile')}
          </Button>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-2 px-5 py-4">
            {/* 号小管账号(账号额度反代)固定置顶:已接入显示真实档,未接入显示占位卡片。 */}
            {accountProfile ? (
              <ProviderRow
                key={accountProfile.id}
                p={accountProfile}
                isAdditive={isAdditive}
                loading={loading}
                routingOn={routingOnActive}
                onTestConn={(id) => void onTestConn(id)}
                onApply={(id) => void onApply(id)}
                onClear={(id) => void onClear(id)}
                onEnable={(id) => void onEnable(id)}
                onDisable={(id) => void onDisable(id)}
                onSetDefault={(id) => void onSetDefault(id)}
                onEdit={(pp) => setView({ mode: 'edit', profile: pp })}
                onDuplicate={(pp) => void onDuplicate(pp)}
                onRemove={(id) => void store.remove(id)}
              />
            ) : (
              <AccountPlaceholderCard onConnect={() => void onConnectLocalProxy()} loading={loading} />
            )}

            {/* 第三方供应商 */}
            {thirdParty.length === 0 ? (
              <div className="rounded-[8px] border border-dashed border-border/60 px-4 py-8 text-center text-[12px] text-muted-foreground/70">
                {t('clientConfigPage.emptyThirdParty')}
              </div>
            ) : (
              thirdParty.map((p) => (
                <ProviderRow
                  key={p.id}
                  p={p}
                  isAdditive={isAdditive}
                  loading={loading}
                  routingOn={routingOnActive}
                  onTestConn={(id) => void onTestConn(id)}
                  onApply={(id) => void onApply(id)}
                  onClear={(id) => void onClear(id)}
                  onEnable={(id) => void onEnable(id)}
                  onDisable={(id) => void onDisable(id)}
                  onSetDefault={(id) => void onSetDefault(id)}
                  onEdit={(pp) => setView({ mode: 'edit', profile: pp })}
                  onDuplicate={(pp) => void onDuplicate(pp)}
                  onRemove={(id) => void store.remove(id)}
                />
              ))
            )}
          </div>
        </ScrollArea>
          </>
        )}
      </section>

      <HistoryDialog entries={historyData} onRollback={(id) => void onRollback(id)} onClose={() => setHistoryData(null)} />

      <CodexSwitchRepairDialog
        open={codexSwitch !== null}
        mode={codexSwitch?.action ?? 'enable'}
        providerName={codexSwitch?.name ?? ''}
        busy={codexSwitchBusy}
        progress={codexSwitchProgress}
        onConfirm={(repairToo) => void doCodexSwitch(repairToo)}
        onCancel={() => { if (!codexSwitchBusy) setCodexSwitch(null); }}
      />

      {/* 「需要中转」硬门槛确认：协议不匹配的供应商必须开启「路由」才能启用。 */}
      <Dialog open={needRelay !== null} onOpenChange={(o) => (o ? undefined : setNeedRelay(null))}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('clientConfigPage.needRelayDialog.title')}</DialogTitle>
          </DialogHeader>
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            {t('clientConfigPage.needRelayDialog.desc', {
              name: needRelay?.name ?? '',
              proto: needRelay?.proto ?? '',
              client: activeInfo?.displayName ?? '',
              native: needRelay?.native ?? '',
            })}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNeedRelay(null)}>
              {t('clientConfigPage.needRelayDialog.cancel')}
            </Button>
            <Button onClick={() => void confirmNeedRelay()}>
              {t('clientConfigPage.needRelayDialog.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
