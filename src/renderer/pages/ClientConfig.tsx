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
import { ProviderBrandIcon } from '@/components/clientConfig/ProviderBrandIcon';
import { AddProviderDialog } from '@/components/clientConfig/AddProviderDialog';
import { EditProviderDialog } from '@/components/clientConfig/EditProviderDialog';
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
} from '@shared/api-types';

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
          ) : p.settings?.routeViaProxy === true ? (
            <span className="rounded-[6px] bg-primary/10 px-1.5 text-[10px] font-medium text-primary">
              {t('clientConfigPage.sourceRelay')}
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
  const { clients, activeClient, profiles, counts, error, loading } = store;
  const codexRelay = useSettingsStore((s) => s.codexRelayInjectionEnabled);
  const setCodexRelay = useSettingsStore((s) => s.setCodexRelayInjectionEnabled);
  const loadSettings = useSettingsStore((s) => s.loadSettings);
  // 右侧视图:列表 / 添加(页面) / 编辑(页面)。添加/编辑作为页面渲染在右侧,带返回。
  const [view, setView] = useState<
    { mode: 'list' } | { mode: 'add' } | { mode: 'edit'; profile: ClientConfigProfileDto }
  >({ mode: 'list' });
  const [historyData, setHistoryData] = useState<ClientConfigSnapshotDto[] | null>(null);

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
  const onEnable = async (id: string) => {
    await store.enable(id);
    toast.success(t('clientConfigPage.applied'));
  };
  const onDisable = async (id: string) => {
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
                    <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <span className={cn('size-1.5 rounded-full', c.detected ? 'bg-emerald-500' : 'bg-zinc-400')} aria-hidden />
                      {c.detected ? t('clientConfigPage.detected') : t('clientConfigPage.notDetected')}
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
          {/* Codex 专属:中转注入(L2 真共存)开关 */}
          {activeClient === 'codex' && (
            <label
              className="flex h-8 shrink-0 items-center gap-1.5 rounded-[8px] border border-border/60 px-2.5"
              title={t('clientConfigPage.relayInjectionHint')}
            >
              <span className="text-[12px] text-muted-foreground">{t('clientConfigPage.relayInjection')}</span>
              <Switch
                checked={codexRelay}
                onCheckedChange={(v) => void setCodexRelay(v)}
                aria-label={t('clientConfigPage.relayInjection')}
              />
            </label>
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
                onTestConn={(id) => void onTestConn(id)}
                onApply={(id) => void store.apply(id)}
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
                    onTestConn={(id) => void onTestConn(id)}
                  onApply={(id) => void store.apply(id)}
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
    </div>
  );
}
