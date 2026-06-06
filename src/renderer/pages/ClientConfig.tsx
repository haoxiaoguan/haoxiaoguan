import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Cable, History, Trash2, Eye, Check } from 'lucide-react';
import { toast } from 'sonner';
import { useClientConfigStore } from '../stores/clientConfigStore';
import { SegmentedOptions } from '@/components/ui/segmented-options';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import type {
  ClientConfigClientId,
  ClientConfigDiffFile,
  ClientConfigSnapshotDto,
} from '@shared/api-types';

// ─── 添加接入档 Sheet（MVP：手动填写第三方/反代地址）──────────────────────
function AddProfileSheet({
  clientId,
  open,
  onOpenChange,
  onCreate,
}: {
  clientId: ClientConfigClientId;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreate: (v: { name: string; baseUrl: string; apiKey: string; model: string }) => Promise<void>;
}) {
  const { t } = useTranslation('nav');
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName('');
      setBaseUrl('');
      setApiKey('');
      setModel('');
    }
  }, [open, clientId]);

  const canSubmit = name.trim().length > 0 && baseUrl.trim().length > 0 && !busy;
  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      await onCreate({ name: name.trim(), baseUrl: baseUrl.trim(), apiKey: apiKey.trim(), model: model.trim() });
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[420px] sm:max-w-[420px]">
        <SheetHeader>
          <SheetTitle>{t('clientConfigPage.form.createTitle')}</SheetTitle>
          <SheetDescription>{t('clientConfigPage.subtitle')}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-3 px-4 py-3">
          <label className="text-[12px] font-medium text-muted-foreground">
            {t('clientConfigPage.form.name')}
            <Input className="mt-1" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('clientConfigPage.form.namePlaceholder')} />
          </label>
          <label className="text-[12px] font-medium text-muted-foreground">
            {t('clientConfigPage.form.baseUrl')}
            <Input className="mt-1 font-mono" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.example.com" />
          </label>
          <label className="text-[12px] font-medium text-muted-foreground">
            {t('clientConfigPage.form.apiKey')}
            <Input className="mt-1 font-mono" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..." />
          </label>
          <label className="text-[12px] font-medium text-muted-foreground">
            {t('clientConfigPage.form.model')}
            <Input className="mt-1 font-mono" value={model} onChange={(e) => setModel(e.target.value)} placeholder="kiro" />
          </label>
        </div>
        <SheetFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('clientConfigPage.form.cancel')}
          </Button>
          <Button disabled={!canSubmit} onClick={() => void submit()}>
            {t('clientConfigPage.form.create')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// ─── 双栏 diff 预览弹窗 ───────────────────────────────────────────────────
function DiffDialog({
  files,
  onApply,
  onClose,
}: {
  files: ClientConfigDiffFile[] | null;
  onApply: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation('nav');
  return (
    <Dialog open={files !== null} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('clientConfigPage.diff.title')}</DialogTitle>
          <DialogDescription>{t('clientConfigPage.subtitle')}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[55vh] space-y-4 overflow-y-auto">
          {(files ?? []).map((f) => (
            <div key={f.file}>
              <div className="mb-1 font-mono text-[11px] text-muted-foreground">{f.file}</div>
              <div className="grid grid-cols-2 gap-2">
                <pre className="overflow-x-auto rounded-[8px] border border-border/60 bg-muted/30 p-2 font-mono text-[11px] leading-relaxed">
                  <div className="mb-1 text-[10px] uppercase text-muted-foreground/60">{t('clientConfigPage.diff.before')}</div>
                  {f.before ?? t('clientConfigPage.diff.empty')}
                </pre>
                <pre className="overflow-x-auto rounded-[8px] border border-primary/40 bg-primary/[0.04] p-2 font-mono text-[11px] leading-relaxed">
                  <div className="mb-1 text-[10px] uppercase text-primary/70">{t('clientConfigPage.diff.after')}</div>
                  {f.after ?? t('clientConfigPage.diff.deleted')}
                </pre>
              </div>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('clientConfigPage.form.cancel')}
          </Button>
          <Button onClick={onApply}>{t('clientConfigPage.diff.apply')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

// ─── 主页面 ───────────────────────────────────────────────────────────────
export default function ClientConfig() {
  const { t } = useTranslation('nav');
  const store = useClientConfigStore();
  const { clients, activeClient, profiles, error, loading } = store;
  const [addOpen, setAddOpen] = useState(false);
  const [diff, setDiff] = useState<{ id: string; files: ClientConfigDiffFile[] } | null>(null);
  const [historyData, setHistoryData] = useState<ClientConfigSnapshotDto[] | null>(null);

  useEffect(() => {
    void store.init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (error) toast.error(error);
  }, [error]);

  const items = clients.map((c) => ({ value: c.clientId, label: c.displayName }));
  const activeDetected = clients.find((c) => c.clientId === activeClient)?.detected ?? false;

  const onPreview = async (id: string) => {
    const files = await store.preview(id);
    // 预览失败(store 吞错返回 [])或无改动时不弹空弹窗。
    if (files.length === 0) {
      toast.message(t('clientConfigPage.diff.noChange'));
      return;
    }
    setDiff({ id, files });
  };
  const onClear = async (id: string) => {
    await store.clear(id);
    toast.success(t('clientConfigPage.cleared'));
  };
  const onApplyFromDiff = async () => {
    if (!diff) return;
    await store.apply(diff.id);
    setDiff(null);
    toast.success(t('clientConfigPage.applied'));
  };
  const onShowHistory = async () => {
    setHistoryData(await store.history());
  };
  const onRollback = async (entryId: string) => {
    await store.rollback(entryId);
    setHistoryData(null);
    toast.success(t('clientConfigPage.rolledBack'));
  };

  return (
    <div className="flex flex-col gap-5 px-6 py-5">
      {/* 标题行 */}
      <div className="flex items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-[9px] bg-primary/10">
          <Cable className="size-4.5 text-primary" strokeWidth={1.85} aria-hidden />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-semibold leading-5 text-foreground">{t('clientConfigPage.title')}</div>
          <div className="mt-0.5 text-[12px] text-muted-foreground">{t('clientConfigPage.subtitle')}</div>
        </div>
        <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-[12px]" onClick={() => void onShowHistory()}>
          <History className="size-3.5" aria-hidden />
          {t('clientConfigPage.history')}
        </Button>
        <Button size="sm" className="h-8 gap-1.5 text-[12px]" onClick={() => setAddOpen(true)}>
          <Plus className="size-3.5" aria-hidden />
          {t('clientConfigPage.addProfile')}
        </Button>
      </div>

      {/* 客户端 pill 切换器 */}
      {items.length > 0 && (
        <div className="flex items-center gap-2">
          <SegmentedOptions items={items} value={activeClient} onChange={(v) => void store.selectClient(v as ClientConfigClientId)} />
          <span className={cn('inline-flex items-center gap-1 text-[11px]', activeDetected ? 'text-emerald-600' : 'text-muted-foreground/60')}>
            <span className={cn('size-1.5 rounded-full', activeDetected ? 'bg-emerald-500' : 'bg-zinc-400')} aria-hidden />
            {activeDetected ? t('clientConfigPage.detected') : t('clientConfigPage.notDetected')}
          </span>
        </div>
      )}

      {/* 接入档卡片列表 */}
      <div className="flex flex-col gap-2">
        {profiles.length === 0 ? (
          <div className="rounded-[8px] border border-dashed border-border/60 px-4 py-8 text-center">
            <div className="text-[13px] text-muted-foreground">{t('clientConfigPage.empty')}</div>
            <div className="mt-1 text-[12px] text-muted-foreground/60">{t('clientConfigPage.emptyHint')}</div>
          </div>
        ) : (
          profiles.map((p) => (
            <div
              key={p.id}
              className={cn(
                'flex items-center gap-3 rounded-[8px] border px-4 py-3',
                p.isCurrent ? 'border-primary/50 bg-primary/[0.04]' : 'border-border/60',
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[13px] font-medium text-foreground">{p.name}</span>
                  {p.isCurrent && (
                    <span className="inline-flex h-5 items-center gap-1 rounded-[6px] bg-primary/10 px-1.5 text-[10px] font-medium text-primary">
                      <Check className="size-3" aria-hidden />
                      {t('clientConfigPage.current')}
                    </span>
                  )}
                  <span className="rounded-[6px] bg-muted px-1.5 text-[10px] text-muted-foreground">
                    {p.source === 'local-proxy' ? t('clientConfigPage.sourceLocal') : t('clientConfigPage.sourceManual')}
                  </span>
                </div>
                <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                  {p.baseUrl}
                  {p.model ? ` · ${p.model}` : ''}
                </div>
              </div>
              <Button size="sm" variant="ghost" disabled={loading} className="h-7 gap-1 text-[12px]" onClick={() => void onPreview(p.id)}>
                <Eye className="size-3.5" aria-hidden />
                {t('clientConfigPage.preview')}
              </Button>
              <Button size="sm" disabled={loading} variant={p.isCurrent ? 'outline' : 'default'} className="h-7 text-[12px]" onClick={() => void store.apply(p.id)}>
                {t('clientConfigPage.enable')}
              </Button>
              {p.isCurrent && (
                <Button size="sm" variant="ghost" disabled={loading} className="h-7 text-[12px] text-muted-foreground" onClick={() => void onClear(p.id)}>
                  {t('clientConfigPage.clear')}
                </Button>
              )}
              <Button size="sm" variant="ghost" disabled={loading} className="h-7 text-[12px] text-muted-foreground hover:text-destructive" onClick={() => void store.remove(p.id)}>
                <Trash2 className="size-3.5" aria-hidden />
              </Button>
            </div>
          ))
        )}
      </div>

      <AddProfileSheet
        clientId={activeClient}
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreate={(v) =>
          store.create({
            clientId: activeClient,
            name: v.name,
            source: 'manual',
            baseUrl: v.baseUrl,
            ...(v.apiKey ? { apiKey: v.apiKey } : {}),
            ...(v.model ? { model: v.model } : {}),
          })
        }
      />
      <DiffDialog files={diff?.files ?? null} onApply={() => void onApplyFromDiff()} onClose={() => setDiff(null)} />
      <HistoryDialog entries={historyData} onRollback={(id) => void onRollback(id)} onClose={() => setHistoryData(null)} />
    </div>
  );
}
