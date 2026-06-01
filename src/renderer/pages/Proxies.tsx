import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Network, Plus, RefreshCw, Trash2, Pencil, Wifi } from 'lucide-react';
import { toast } from 'sonner';
import { useProxyStore } from '../stores/proxyStore';
import type { ProxyDto, ProxyProtocolDto } from '@shared/api-types';
import {
  ManagementInfoPill,
  ManagementSearchField,
  ManagementActionButton,
  ManagementIconButton,
} from '@/components/management/ManagementControls';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import { SegmentedOptions } from '@/components/ui/segmented-options';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { DataTable } from '@/components/ui/data-table';
import type { ColumnDef, ColumnPinningState } from '@tanstack/react-table';
import { cn } from '@/lib/utils';

type StatusFilter = 'all' | 'ok' | 'failed' | 'unknown';

// Address sticks to the left, actions to the right (antd-style fixed columns).
const PROXY_PINNING: ColumnPinningState = { left: ['address'], right: ['actions'] };

interface FormState {
  id?: string;
  protocol: ProxyProtocolDto;
  host: string;
  port: string;
  username: string;
  password: string;
  label: string;
  tags: string;
  passwordSet: boolean;
}

const EMPTY_FORM: FormState = {
  protocol: 'http',
  host: '',
  port: '',
  username: '',
  password: '',
  label: '',
  tags: '',
  passwordSet: false,
};

export default function Proxies() {
  const { t } = useTranslation('proxy');
  const {
    proxies,
    loading,
    testingIds,
    error,
    fetchAll,
    createProxy,
    updateProxy,
    deleteProxy,
    importProxies,
    testProxy,
    testProxies,
  } = useProxyStore();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [addOpen, setAddOpen] = useState(false);
  const [addTab, setAddTab] = useState<'manual' | 'paste'>('manual');
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [pasteText, setPasteText] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<ProxyDto | null>(null);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    if (error) toast.error(error);
  }, [error]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return proxies.filter((p) => {
      if (statusFilter !== 'all' && p.status !== statusFilter) return false;
      if (q === '') return true;
      return (
        p.host.toLowerCase().includes(q) ||
        (p.label ?? '').toLowerCase().includes(q) ||
        p.tags.some((tag) => tag.toLowerCase().includes(q))
      );
    });
  }, [proxies, search, statusFilter]);

  const okCount = useMemo(() => proxies.filter((p) => p.status === 'ok').length, [proxies]);

  const openAdd = () => {
    setForm(EMPTY_FORM);
    setPasteText('');
    setAddTab('manual');
    setAddOpen(true);
  };

  const openEdit = (proxy: ProxyDto) => {
    setForm({
      id: proxy.id,
      protocol: proxy.protocol,
      host: proxy.host,
      port: String(proxy.port),
      username: proxy.username ?? '',
      password: '',
      label: proxy.label ?? '',
      tags: proxy.tags.join(', '),
      passwordSet: proxy.passwordSet,
    });
    setAddTab('manual');
    setAddOpen(true);
  };

  const submitForm = async () => {
    const port = Number.parseInt(form.port, 10);
    if (form.host.trim() === '' || Number.isNaN(port)) {
      toast.error(t('form.host') + ' / ' + t('form.port'));
      return;
    }
    const tags = form.tags
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== '');
    try {
      if (form.id) {
        await updateProxy(form.id, {
          label: form.label,
          protocol: form.protocol,
          host: form.host,
          port,
          username: form.username || undefined,
          // empty password on edit = keep existing (do not clear)
          password: form.password === '' ? undefined : form.password,
          tags,
        });
      } else {
        await createProxy({
          label: form.label || undefined,
          protocol: form.protocol,
          host: form.host,
          port,
          username: form.username || undefined,
          password: form.password || undefined,
          tags,
        });
      }
      setAddOpen(false);
    } catch {
      // error toast handled via store error effect
    }
  };

  const submitPaste = async () => {
    const summary = await importProxies(pasteText);
    if (summary) {
      toast.success(
        t('import.summary', {
          imported: summary.imported,
          skipped: summary.skipped,
          failed: summary.failed.length,
        }),
      );
      setAddOpen(false);
      setPasteText('');
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteProxy(deleteTarget.id);
      toast.success(t('table.delete'));
    } catch (e) {
      toast.error(String(e));
    } finally {
      setDeleteTarget(null);
    }
  };

  const handleTestAll = () => {
    if (filtered.length > 0) void testProxies(filtered.map((p) => p.id));
  };

  const columns = useMemo<ColumnDef<ProxyDto>[]>(
    () => [
      {
        id: 'address',
        size: 240,
        header: () => t('table.address'),
        cell: ({ row }) => (
          <span className="block truncate font-mono text-[12px]">{row.original.displayUrl}</span>
        ),
      },
      {
        id: 'label',
        size: 180,
        header: () => t('table.label'),
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="truncate font-medium">{row.original.label || row.original.host}</div>
            {row.original.tags.length > 0 ? (
              <div className="mt-0.5 flex flex-wrap gap-1">
                {row.original.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ),
      },
      {
        id: 'status',
        size: 96,
        header: () => t('table.status'),
        cell: ({ row }) => (
          <StatusBadge status={row.original.status} label={t(`status.${row.original.status}`)} />
        ),
      },
      {
        id: 'egressIp',
        size: 140,
        header: () => t('table.egressIp'),
        cell: ({ row }) => (
          <span className="block truncate font-mono text-[12px]">
            {row.original.lastEgressIp ?? '—'}
          </span>
        ),
      },
      {
        id: 'latency',
        size: 90,
        header: () => t('table.latency'),
        cell: ({ row }) =>
          row.original.lastLatencyMs != null ? `${row.original.lastLatencyMs}ms` : '—',
      },
      {
        id: 'bindings',
        size: 110,
        header: () => t('table.bindings'),
        cell: ({ row }) => (
          <span className="text-[12px] text-muted-foreground">
            {t('table.bindingCount', { accounts: row.original.boundAccountCount })}
          </span>
        ),
      },
      {
        id: 'lastChecked',
        size: 170,
        header: () => t('table.lastChecked'),
        cell: ({ row }) => (
          <span className="block truncate text-[12px] text-muted-foreground">
            {row.original.lastCheckedAt ? new Date(row.original.lastCheckedAt).toLocaleString() : '—'}
          </span>
        ),
      },
      {
        id: 'actions',
        size: 128,
        header: () => <span className="block text-right">{t('table.actions')}</span>,
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-1">
            <ManagementIconButton
              label={t('table.test')}
              icon={Wifi}
              spin={testingIds.has(row.original.id)}
              disabled={testingIds.has(row.original.id)}
              onClick={() => void testProxy(row.original.id)}
            />
            <ManagementIconButton
              label={t('table.edit')}
              icon={Pencil}
              onClick={() => openEdit(row.original)}
            />
            <ManagementIconButton
              label={t('table.delete')}
              icon={Trash2}
              onClick={() => setDeleteTarget(row.original)}
            />
          </div>
        ),
      },
    ],
    // openEdit is stable within a render; t/testingIds drive labels + spinners.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, testingIds],
  );

  return (
    <div className="flex h-[calc(100vh-98px)] min-h-0 flex-col overflow-hidden px-6 py-5">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 pb-3">
        <ManagementInfoPill
          icon={Network}
          tone="blue"
          label={t('summary.total', { count: proxies.length })}
        />
        <ManagementInfoPill tone="green" label={t('summary.ok', { count: okCount })} />
        <div className="flex-1" />
        <ManagementActionButton icon={Plus} onClick={openAdd}>
          {t('toolbar.add')}
        </ManagementActionButton>
        <ManagementActionButton
          icon={Wifi}
          onClick={handleTestAll}
          disabled={filtered.length === 0 || testingIds.size > 0}
        >
          {t('toolbar.testAll')}
        </ManagementActionButton>
        <ManagementSearchField
          value={search}
          onChange={setSearch}
          placeholder={t('toolbar.search')}
          testId="proxy-search"
        />
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <SelectTrigger className="h-8 w-[110px] rounded-[8px] bg-card text-[12px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            <SelectItem value="all">{t('toolbar.filter.all')}</SelectItem>
            <SelectItem value="ok">{t('toolbar.filter.ok')}</SelectItem>
            <SelectItem value="failed">{t('toolbar.filter.failed')}</SelectItem>
            <SelectItem value="unknown">{t('toolbar.filter.unknown')}</SelectItem>
          </SelectContent>
        </Select>
        <ManagementIconButton
          label={t('toolbar.testAll')}
          icon={RefreshCw}
          spin={loading}
          onClick={() => void fetchAll()}
        />
      </div>

      {/* Table */}
      <div className="min-h-0 flex-1 overflow-hidden">
        <DataTable
          columns={columns}
          data={filtered}
          getRowId={(p) => p.id}
          columnPinning={PROXY_PINNING}
          className="h-full"
          rowTestId="proxy-row"
          emptyState={
            <div className="py-10 text-center text-muted-foreground">{t('table.empty')}</div>
          }
        />
      </div>

      {/* Add (manual / paste tabs) + Edit dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>
              {form.id ? t('form.editTitle') : t('addDialog.title')}
            </DialogTitle>
          </DialogHeader>

          {/* Tab switcher — only when adding (editing is manual-only) */}
          {!form.id ? (
            <SegmentedOptions
              items={[
                { value: 'manual', label: t('addDialog.tabManual') },
                { value: 'paste', label: t('addDialog.tabPaste') },
              ]}
              value={addTab}
              onChange={(v) => setAddTab(v as 'manual' | 'paste')}
              fullWidth
            />
          ) : null}

          {form.id || addTab === 'manual' ? (
            <>
              <div className="grid gap-3 py-2">
                <div className="grid grid-cols-[1fr_2fr] gap-2">
                  <div>
                    <label className="text-[12px] text-muted-foreground">{t('form.protocol')}</label>
                    <Select
                      value={form.protocol}
                      onValueChange={(v) =>
                        setForm((f) => ({ ...f, protocol: v as ProxyProtocolDto }))
                      }
                    >
                      <SelectTrigger className="h-9 rounded-[8px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="http">HTTP</SelectItem>
                        <SelectItem value="https">HTTPS</SelectItem>
                        <SelectItem value="socks5">SOCKS5</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-[12px] text-muted-foreground">{t('form.host')}</label>
                    <Input
                      value={form.host}
                      onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))}
                      placeholder="1.2.3.4"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[12px] text-muted-foreground">{t('form.port')}</label>
                    <Input
                      value={form.port}
                      onChange={(e) => setForm((f) => ({ ...f, port: e.target.value }))}
                      placeholder="8080"
                      inputMode="numeric"
                    />
                  </div>
                  <div>
                    <label className="text-[12px] text-muted-foreground">{t('form.label')}</label>
                    <Input
                      value={form.label}
                      onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[12px] text-muted-foreground">{t('form.username')}</label>
                    <Input
                      value={form.username}
                      onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="text-[12px] text-muted-foreground">{t('form.password')}</label>
                    <Input
                      type="password"
                      value={form.password}
                      onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                      placeholder={form.passwordSet ? t('form.passwordSetPlaceholder') : ''}
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[12px] text-muted-foreground">{t('form.tags')}</label>
                  <Input
                    value={form.tags}
                    onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
                    placeholder="prod, us-east"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setAddOpen(false)}>
                  {t('form.cancel')}
                </Button>
                <Button onClick={() => void submitForm()}>{t('form.save')}</Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <Textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder={t('paste.placeholder')}
                className="mt-2 min-h-[180px] font-mono text-[12px]"
              />
              <DialogFooter>
                <Button variant="outline" onClick={() => setAddOpen(false)}>
                  {t('form.cancel')}
                </Button>
                <Button onClick={() => void submitPaste()} disabled={pasteText.trim() === ''}>
                  {t('paste.import')}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('delete.confirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && deleteTarget.boundAccountCount > 0
                ? t('delete.blocked', {
                    accounts: deleteTarget.boundAccountCount,
                  })
                : t('delete.confirmBody')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('form.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className={cn(
                'bg-destructive text-destructive-foreground hover:bg-destructive/90',
              )}
              onClick={() => void confirmDelete()}
            >
              {t('table.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function StatusBadge({ status, label }: { status: ProxyDto['status']; label: string }) {
  const tone =
    status === 'ok'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600'
      : status === 'failed'
        ? 'border-red-500/30 bg-red-500/10 text-red-600'
        : 'border-slate-400/30 bg-slate-400/10 text-slate-500';
  return (
    <Badge variant="outline" className={cn('rounded-[6px] text-[11px]', tone)}>
      {label}
    </Badge>
  );
}
