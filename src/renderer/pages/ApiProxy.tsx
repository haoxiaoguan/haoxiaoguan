import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plug, Copy, Key, Trash2, Activity, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useApiProxyStore } from '../stores/apiProxyStore';
import type { AccountPoolHealthRow } from '@shared/api-types';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

export default function ApiProxy() {
  const { t } = useTranslation('nav');
  const {
    status,
    loading,
    error,
    fetchStatus,
    start,
    stop,
    keys,
    newPlaintext,
    fetchKeys,
    createKey,
    setKeyActive,
    deleteKey,
    clearNewPlaintext,
    poolHealth,
    fetchPoolHealth,
    clearSuspension,
  } = useApiProxyStore();

  const [createOpen, setCreateOpen] = useState(false);
  const [keyName, setKeyName] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    void fetchKeys();
  }, [fetchKeys]);

  useEffect(() => {
    void fetchPoolHealth();
  }, [fetchPoolHealth]);

  useEffect(() => {
    if (error) toast.error(error);
  }, [error]);

  const running = status.state === 'running';
  const baseUrl = useMemo(
    () => (status.port ? `http://127.0.0.1:${status.port}` : ''),
    [status.port],
  );

  const onToggle = (next: boolean) => {
    if (loading) return;
    if (next) void start();
    else void stop();
  };

  const copyBaseUrl = async () => {
    if (!baseUrl) return;
    try {
      await navigator.clipboard.writeText(baseUrl);
      toast.success(baseUrl);
    } catch {
      toast.error(baseUrl);
    }
  };

  const handleCreateKey = async () => {
    const name = keyName.trim();
    if (!name) return;
    setCreating(true);
    try {
      await createKey(name);
      setCreateOpen(false);
      setKeyName('');
    } finally {
      setCreating(false);
    }
  };

  const handleCopyPlaintext = async () => {
    if (!newPlaintext) return;
    try {
      await navigator.clipboard.writeText(newPlaintext);
      toast.success(t('copy'));
    } catch {
      toast.error(newPlaintext);
    }
  };

  return (
    <div className="flex flex-col gap-4 px-6 py-5" data-testid="api-proxy-page">
      {/* Service status card */}
      <div className="rounded-[10px] border border-border/80 bg-card p-5">
        <div className="flex items-center gap-3">
          <Plug className="size-5 text-primary" strokeWidth={1.85} aria-hidden />
          <div className="flex-1">
            <div className="text-[15px] font-semibold text-foreground">{t('apiService')}</div>
            <div className="text-[12px] text-muted-foreground">127.0.0.1</div>
          </div>
          <StatusBadge running={running} />
          <Switch
            checked={running}
            disabled={loading}
            onCheckedChange={onToggle}
            aria-label={t('apiService')}
          />
        </div>

        {running && baseUrl ? (
          <div className="mt-4 flex items-center gap-2">
            <span className="text-[12px] text-muted-foreground">Base URL</span>
            <code className="rounded bg-muted px-2 py-1 font-mono text-[12px]">{baseUrl}</code>
            <Button variant="outline" size="sm" onClick={() => void copyBaseUrl()}>
              <Copy className="mr-1 size-3.5" aria-hidden />
              {t('copy')}
            </Button>
          </div>
        ) : null}
      </div>

      {/* Client Keys card */}
      <div className="rounded-[10px] border border-border/80 bg-card p-5">
        <div className="flex items-center gap-3">
          <Key className="size-5 text-primary" strokeWidth={1.85} aria-hidden />
          <div className="flex-1">
            <div className="text-[15px] font-semibold text-foreground">
              {t('clientKeys.title')}
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setKeyName('');
              setCreateOpen(true);
            }}
          >
            {t('clientKeys.create')}
          </Button>
        </div>

        {keys.length === 0 ? (
          <p className="mt-4 text-[12px] text-muted-foreground">{t('clientKeys.empty')}</p>
        ) : (
          <div className="mt-4 flex flex-col gap-2">
            {keys.map((k) => (
              <div
                key={k.id}
                className="flex items-center gap-3 rounded-[8px] border border-border/60 bg-muted/30 px-3 py-2"
              >
                <div className="flex-1 min-w-0">
                  <span className="text-[13px] font-medium text-foreground truncate block">
                    {k.name}
                  </span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {k.keyPrefix}…
                  </span>
                </div>
                <Switch
                  checked={k.isActive}
                  onCheckedChange={(v) => void setKeyActive(k.id, v)}
                  aria-label={k.name}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-muted-foreground hover:text-destructive"
                  onClick={() => void deleteKey(k.id)}
                  aria-label={t('clientKeys.delete')}
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create Key dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('clientKeys.createTitle')}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2 py-2">
            <label className="text-[13px] text-muted-foreground">{t('clientKeys.nameLabel')}</label>
            <Input
              value={keyName}
              onChange={(e) => setKeyName(e.target.value)}
              placeholder={t('clientKeys.namePlaceholder')}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleCreateKey();
              }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" size="sm">
                {t('clientKeys.cancel')}
              </Button>
            </DialogClose>
            <Button size="sm" disabled={!keyName.trim() || creating} onClick={() => void handleCreateKey()}>
              {t('clientKeys.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* One-time plaintext reveal dialog */}
      <Dialog
        open={newPlaintext !== null}
        onOpenChange={(open) => {
          if (!open) clearNewPlaintext();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('clientKeys.plaintextTitle')}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            <p className="text-[13px] text-amber-600 dark:text-amber-400">
              {t('clientKeys.plaintextWarning')}
            </p>
            <code className="break-all rounded bg-muted px-3 py-2 font-mono text-[12px] text-foreground select-all">
              {newPlaintext}
            </code>
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => void handleCopyPlaintext()}
            >
              <Copy className="mr-1 size-3.5" aria-hidden />
              {t('clientKeys.copyKey')}
            </Button>
          </div>
          <DialogFooter>
            <Button
              size="sm"
              onClick={clearNewPlaintext}
            >
              {t('clientKeys.close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Account Pool Health card */}
      <AccountPoolHealthCard
        poolHealth={poolHealth}
        onRefresh={() => void fetchPoolHealth()}
        onClearSuspension={(id) => void clearSuspension(id)}
        t={t}
      />
    </div>
  );
}

function AccountPoolHealthCard({
  poolHealth,
  onRefresh,
  onClearSuspension,
  t,
}: {
  poolHealth: AccountPoolHealthRow[];
  onRefresh: () => void;
  onClearSuspension: (accountId: string) => void;
  t: (key: string) => string;
}) {
  const now = Date.now();

  return (
    <div className="rounded-[10px] border border-border/80 bg-card p-5">
      <div className="flex items-center gap-3">
        <Activity className="size-5 text-primary" strokeWidth={1.85} aria-hidden />
        <div className="flex-1">
          <div className="text-[15px] font-semibold text-foreground">
            {t('poolHealth.title')}
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={onRefresh}>
          <RefreshCw className="mr-1 size-3.5" aria-hidden />
          {t('poolHealth.refresh')}
        </Button>
      </div>

      {poolHealth.length === 0 ? (
        <p className="mt-4 text-[12px] text-muted-foreground">{t('poolHealth.empty')}</p>
      ) : (
        <div className="mt-4 flex flex-col gap-2">
          {poolHealth.map((row) => {
            const isSuspended =
              row.runtimeState === 'suspended' || row.status === 'SUSPENDED';
            let stateLabel = t(`poolHealth.state.${row.runtimeState}`);
            if (row.runtimeState === 'cooldown' && row.cooldownUntilMs !== undefined) {
              const remaining = Math.max(0, Math.ceil((row.cooldownUntilMs - now) / 1000));
              stateLabel = `${stateLabel} (${remaining}s)`;
            } else if (
              row.runtimeState === 'quota_exhausted' &&
              row.quotaResetsAtMs !== undefined
            ) {
              const resetAt = new Date(row.quotaResetsAtMs).toLocaleTimeString(
                [],
                { hour: '2-digit', minute: '2-digit' },
              );
              stateLabel = `${stateLabel} → ${resetAt}`;
            }

            return (
              <div
                key={row.accountId}
                className="flex items-center gap-3 rounded-[8px] border border-border/60 bg-muted/30 px-3 py-2"
              >
                <div className="flex-1 min-w-0">
                  <span className="text-[13px] font-medium text-foreground truncate block">
                    {row.email}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {t('poolHealth.failures')}: {row.failureCount}
                  </span>
                </div>
                <RuntimeStateBadge state={row.runtimeState} label={stateLabel} />
                {isSuspended ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0 text-[12px]"
                    onClick={() => onClearSuspension(row.accountId)}
                  >
                    {t('poolHealth.clearSuspension')}
                  </Button>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const RUNTIME_STATE_TONE: Record<string, { className: string; dot: string }> = {
  available: { className: 'bg-emerald-500/10 text-emerald-700', dot: 'bg-emerald-500' },
  cooldown: { className: 'bg-yellow-500/10 text-yellow-700', dot: 'bg-yellow-500' },
  quota_exhausted: { className: 'bg-orange-500/10 text-orange-600', dot: 'bg-orange-500' },
  suspended: { className: 'bg-rose-500/10 text-rose-600', dot: 'bg-rose-500' },
};

function RuntimeStateBadge({
  state,
  label,
}: {
  state: string;
  label: string;
}) {
  const tone = RUNTIME_STATE_TONE[state] ?? { className: 'bg-zinc-500/10 text-zinc-600', dot: 'bg-zinc-400' };
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1 rounded-[6px] px-1.5 text-[11px] font-medium',
        tone.className,
      )}
    >
      <span className={cn('size-1.5 rounded-full', tone.dot)} aria-hidden />
      {label}
    </span>
  );
}

function StatusBadge({ running }: { running: boolean }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'rounded-[6px] text-[11px]',
        running
          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600'
          : 'border-slate-400/30 bg-slate-400/10 text-slate-500',
      )}
    >
      {running ? 'running' : 'stopped'}
    </Badge>
  );
}
