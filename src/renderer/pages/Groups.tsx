import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronLeft,
  ChevronRight,
  FolderTree,
  Pencil,
  Plus,
  Search,
  Trash2,
  Wifi,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SegmentedOptions } from '@/components/ui/segmented-options';
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
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import {
  ManagementInfoPill,
  ManagementSearchField,
  ManagementActionButton,
  ManagementIconButton,
} from '@/components/management/ManagementControls';
import { useAccountGroupStore, useAccountStore } from '../stores';
import { useProxyStore } from '../stores/proxyStore';
import { accountGroupService } from '../services/tauri';
import { cn } from '@/lib/utils';
import type { AccountGroupDto, ProxyDto } from '@shared/api-types';
import type { Account } from '../types';

const DEFAULT_COLOR = '#0ea5e9';
const HEX = /^#[0-9a-fA-F]{6}$/;
type BindingMode = 'none' | 'proxy';

// Name sticks to the left, actions to the right (antd-style fixed columns).
const GROUP_PINNING: ColumnPinningState = { left: ['name'], right: ['actions'] };

/**
 * Groups — cross-platform account groups as a flat list. Create / edit both go
 * through a 3-step wizard dialog (basics → members → proxy), so the page itself
 * stays a clean overview table. Deletion is guarded for non-empty groups.
 */
export default function Groups() {
  const { t } = useTranslation('accounts');

  const groups = useAccountGroupStore((s) => s.groups);
  const loading = useAccountGroupStore((s) => s.loading);
  const error = useAccountGroupStore((s) => s.error);
  const fetchGroups = useAccountGroupStore((s) => s.fetchGroups);
  const deleteGroup = useAccountGroupStore((s) => s.deleteGroup);

  const fetchAccounts = useAccountStore((s) => s.fetchAccounts);
  const accountsByPlatform = useAccountStore((s) => s.accounts);
  const allAccounts = useMemo(() => {
    const out: Account[] = [];
    accountsByPlatform.forEach((list) => out.push(...list));
    return out;
  }, [accountsByPlatform]);

  const proxies = useProxyStore((s) => s.proxies);
  const fetchProxies = useProxyStore((s) => s.fetchAll);

  const [search, setSearch] = useState('');
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AccountGroupDto | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AccountGroupDto | null>(null);
  const [forceDelete, setForceDelete] = useState(false);

  useEffect(() => {
    void fetchGroups();
    void fetchProxies();
    void fetchAccounts('cursor');
  }, [fetchGroups, fetchProxies, fetchAccounts]);

  useEffect(() => {
    if (error) toast.error(error);
  }, [error]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q === '') return groups;
    return groups.filter(
      (g) =>
        g.name.toLowerCase().includes(q) || (g.description ?? '').toLowerCase().includes(q),
    );
  }, [groups, search]);

  const boundCount = useMemo(() => groups.filter((g) => g.proxyBinding).length, [groups]);

  const openCreate = () => {
    setEditTarget(null);
    setWizardOpen(true);
  };
  const openEdit = (g: AccountGroupDto) => {
    setEditTarget(g);
    setWizardOpen(true);
  };

  const submitDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteGroup(deleteTarget.id, forceDelete);
      toast.success(t('actions.delete'));
    } catch (e) {
      toast.error(t('edit.failed'), { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setDeleteTarget(null);
      setForceDelete(false);
    }
  };

  const proxyLabel = (g: AccountGroupDto): { label: string; bound: boolean } => {
    const b = g.proxyBinding;
    if (!b) return { label: t('group.binding.none'), bound: false };
    if (b.proxyId) {
      const p = proxies.find((px) => px.id === b.proxyId);
      return { label: p ? p.label || p.displayUrl : t('group.binding.bound'), bound: true };
    }
    return { label: t('group.binding.none'), bound: false };
  };

  const columns = useMemo<ColumnDef<AccountGroupDto>[]>(
    () => [
      {
        id: 'name',
        size: 220,
        header: () => t('group.table.name'),
        cell: ({ row }) => (
          <div className="flex items-center gap-2.5">
            <span
              className="size-3 shrink-0 rounded-full border border-border/60"
              style={{ backgroundColor: row.original.color ?? '#94a3b8' }}
              aria-hidden
            />
            <span className="truncate font-medium">{row.original.name}</span>
          </div>
        ),
      },
      {
        id: 'members',
        size: 120,
        header: () => t('group.table.members'),
        cell: ({ row }) => (
          <span className="text-[12px] text-muted-foreground">
            {t('group.memberCount', { count: row.original.memberCount })}
          </span>
        ),
      },
      {
        id: 'proxy',
        size: 220,
        header: () => t('group.table.proxy'),
        cell: ({ row }) => {
          const proxy = proxyLabel(row.original);
          return proxy.bound ? (
            <Badge
              variant="outline"
              className="h-5 max-w-[200px] gap-1 truncate border-emerald-500/30 bg-emerald-500/10 text-[11px] text-emerald-700"
            >
              <Wifi className="size-3" strokeWidth={1.9} />
              {proxy.label}
            </Badge>
          ) : (
            <span className="text-[12px] text-muted-foreground">{proxy.label}</span>
          );
        },
      },
      {
        id: 'description',
        size: 280,
        header: () => t('group.table.description'),
        cell: ({ row }) => (
          <span className="block truncate text-[12px] text-muted-foreground">
            {row.original.description || '—'}
          </span>
        ),
      },
      {
        id: 'actions',
        size: 96,
        header: () => <span className="block text-right">{t('group.table.actions')}</span>,
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-1">
            <ManagementIconButton
              label={t('group.edit')}
              icon={Pencil}
              onClick={() => openEdit(row.original)}
            />
            <ManagementIconButton
              label={t('actions.delete')}
              icon={Trash2}
              onClick={() => setDeleteTarget(row.original)}
            />
          </div>
        ),
      },
    ],
    // proxyLabel/openEdit are stable within a render; proxies + t drive labels.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, proxies],
  );

  const showLoading = loading && groups.length === 0;

  return (
    <div className="flex h-[calc(100vh-98px)] min-h-0 flex-col overflow-hidden px-6 py-5">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 pb-3">
        <ManagementInfoPill
          icon={FolderTree}
          tone="blue"
          label={t('group.summary.total', { count: groups.length })}
        />
        <ManagementInfoPill
          icon={Wifi}
          tone="green"
          label={t('group.summary.bound', { count: boundCount })}
        />
        <div className="flex-1" />
        <ManagementActionButton icon={Plus} onClick={openCreate}>
          {t('group.create')}
        </ManagementActionButton>
        <ManagementSearchField
          value={search}
          onChange={setSearch}
          placeholder={t('group.wizard.searchMember')}
          testId="group-search"
        />
      </div>

      {/* Table */}
      <div className="min-h-0 flex-1 overflow-hidden">
        <DataTable
          columns={columns}
          data={showLoading ? [] : filtered}
          getRowId={(g) => g.id}
          columnPinning={GROUP_PINNING}
          className="h-full"
          rowTestId="group-row"
          emptyState={
            <div className="py-12 text-center text-muted-foreground">
              {showLoading ? (
                <div className="mx-auto size-5 animate-spin rounded-full border-2 border-muted-foreground border-t-foreground" />
              ) : (
                t('group.table.empty')
              )}
            </div>
          }
        />
      </div>

      <GroupWizardDialog
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        editTarget={editTarget}
        accounts={allAccounts}
        proxies={proxies}
        onDone={() => {
          setWizardOpen(false);
          void fetchGroups();
        }}
      />

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(v) => {
          if (!v) {
            setDeleteTarget(null);
            setForceDelete(false);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('group.deleteConfirm')}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && deleteTarget.memberCount > 0
                ? t('group.deleteWithMembers', { count: deleteTarget.memberCount })
                : t('group.deleteConfirm')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteTarget && deleteTarget.memberCount > 0 ? (
            <label className="flex items-center gap-2 text-[12px]">
              <Checkbox checked={forceDelete} onCheckedChange={(v) => setForceDelete(v === true)} />
              {t('group.forceDelete')}
            </label>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>{t('group.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className={cn('bg-destructive text-destructive-foreground hover:bg-destructive/90')}
              disabled={deleteTarget !== null && deleteTarget.memberCount > 0 && !forceDelete}
              onClick={() => void submitDelete()}
            >
              {t('actions.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ============================================================================
// 3-step wizard (create + edit)
// ============================================================================

interface WizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editTarget: AccountGroupDto | null;
  accounts: Account[];
  proxies: ProxyDto[];
  onDone: () => void;
}

function GroupWizardDialog({
  open,
  onOpenChange,
  editTarget,
  accounts,
  proxies,
  onDone,
}: WizardProps) {
  const { t } = useTranslation('accounts');
  const createGroup = useAccountGroupStore((s) => s.createGroup);
  const updateGroup = useAccountGroupStore((s) => s.updateGroup);
  const addMembers = useAccountGroupStore((s) => s.addMembers);
  const removeMembers = useAccountGroupStore((s) => s.removeMembers);
  const bindGroupToProxy = useAccountGroupStore((s) => s.bindGroupToProxy);
  const unbindGroup = useAccountGroupStore((s) => s.unbindGroup);

  const isEdit = editTarget !== null;
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);

  // step 1 — basics
  const [name, setName] = useState('');
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [description, setDescription] = useState('');

  // step 2 — members (accumulated; committed on finish)
  const [memberIds, setMemberIds] = useState<Set<string>>(new Set());
  const [initialMemberIds, setInitialMemberIds] = useState<Set<string>>(new Set());
  const [memberQuery, setMemberQuery] = useState('');

  // step 3 — proxy binding
  const [bindMode, setBindMode] = useState<BindingMode>('none');
  const [bindProxyId, setBindProxyId] = useState('');

  // Hydrate the form whenever the dialog opens (for create: blank; for edit:
  // load the group's current state, including its members from IPC).
  useEffect(() => {
    if (!open) return;
    setStep(1);
    setBusy(false);
    setMemberQuery('');
    if (editTarget) {
      setName(editTarget.name);
      setColor(editTarget.color ?? DEFAULT_COLOR);
      setDescription(editTarget.description ?? '');
      setBindMode(editTarget.proxyBinding?.proxyId ? 'proxy' : 'none');
      setBindProxyId(editTarget.proxyBinding?.proxyId ?? '');
      void accountGroupService.listMembers(editTarget.id).then((rows) => {
        const ids = new Set(rows.map((r) => r.accountId));
        setMemberIds(ids);
        setInitialMemberIds(ids);
      });
    } else {
      setName('');
      setColor(DEFAULT_COLOR);
      setDescription('');
      setMemberIds(new Set());
      setInitialMemberIds(new Set());
      setBindMode('none');
      setBindProxyId('');
    }
  }, [open, editTarget]);

  const candidates = useMemo(() => {
    const q = memberQuery.trim().toLowerCase();
    if (q === '') return accounts;
    return accounts.filter(
      (a) =>
        a.email.toLowerCase().includes(q) ||
        a.displayIdentifier.toLowerCase().includes(q) ||
        (a.name?.toLowerCase().includes(q) ?? false),
    );
  }, [accounts, memberQuery]);

  const toggleMember = (id: string) =>
    setMemberIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const canProceedStep1 = name.trim() !== '';

  const finish = async () => {
    if (name.trim() === '') {
      setStep(1);
      toast.error(t('group.name'));
      return;
    }
    setBusy(true);
    try {
      // 1. create or update the group itself
      const saved = isEdit
        ? await updateGroup(editTarget!.id, {
            name: name.trim(),
            color: color.trim() === '' ? null : color.trim(),
            description: description.trim() === '' ? null : description.trim(),
          })
        : await createGroup({
            name: name.trim(),
            color: color || undefined,
            description: description.trim() || undefined,
          });

      // 2. reconcile membership (diff against the initial set)
      const toAdd = [...memberIds].filter((id) => !initialMemberIds.has(id));
      const toRemove = [...initialMemberIds].filter((id) => !memberIds.has(id));
      if (toAdd.length > 0) await addMembers(saved.id, toAdd);
      if (toRemove.length > 0) await removeMembers(saved.id, toRemove);

      // 3. apply proxy binding
      if (bindMode === 'none') {
        if (editTarget?.proxyBinding) await unbindGroup(saved.id);
      } else if (bindMode === 'proxy' && bindProxyId !== '') {
        await bindGroupToProxy(saved.id, bindProxyId);
      }

      toast.success(isEdit ? t('group.wizard.updated') : t('group.wizard.created'));
      onDone();
    } catch (e) {
      toast.error(t('edit.failed'), { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const steps = [t('group.wizard.step1'), t('group.wizard.step2'), t('group.wizard.step3')];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] flex-col sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{isEdit ? t('group.edit') : t('group.create')}</DialogTitle>
          <DialogDescription>
            {t('group.wizard.stepOf', { current: step, total: 3 })} · {steps[step - 1]}
          </DialogDescription>
        </DialogHeader>

        {/* Stepper */}
        <ol className="flex items-center gap-2 pb-1">
          {steps.map((label, i) => {
            const n = i + 1;
            const active = n === step;
            const done = n < step;
            return (
              <li key={label} className="flex flex-1 items-center gap-2">
                <span
                  className={cn(
                    'flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
                    active
                      ? 'bg-primary text-primary-foreground'
                      : done
                        ? 'bg-primary/20 text-primary'
                        : 'bg-muted text-muted-foreground',
                  )}
                >
                  {n}
                </span>
                <span
                  className={cn(
                    'truncate text-[12px]',
                    active ? 'font-medium text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {label}
                </span>
                {i < steps.length - 1 ? (
                  <span className="h-px flex-1 bg-border" aria-hidden />
                ) : null}
              </li>
            );
          })}
        </ol>

        {/* Step body. overflow-visible (not hidden) so a focused input's focus
            ring isn't clipped at the edges. Step 2's member list has its own
            fixed-height ScrollArea, so this body never needs to clip/scroll. */}
        <div className="min-h-[260px] flex-1 overflow-visible py-2">
          {step === 1 ? (
            <div className="grid gap-3">
              <div>
                <label className="text-[12px] text-muted-foreground">{t('group.name')}</label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('group.wizard.namePlaceholder')}
                  autoFocus
                />
              </div>
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <div>
                  <label className="text-[12px] text-muted-foreground">{t('group.color')}</label>
                  <Input
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    className="font-mono"
                    placeholder="#0ea5e9"
                  />
                </div>
                <div>
                  <label className="text-[12px] text-muted-foreground">&nbsp;</label>
                  <input
                    type="color"
                    value={HEX.test(color) ? color : DEFAULT_COLOR}
                    onChange={(e) => setColor(e.target.value)}
                    className="h-9 w-12 cursor-pointer rounded-[8px] border border-input bg-card"
                    aria-label={t('group.color')}
                  />
                </div>
              </div>
              <div>
                <label className="text-[12px] text-muted-foreground">{t('group.description')}</label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="min-h-[72px]"
                />
              </div>
            </div>
          ) : step === 2 ? (
            <div className="flex h-full flex-col gap-2">
              <p className="text-[12px] text-muted-foreground">{t('group.wizard.memberHint')}</p>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                  strokeWidth={1.9}
                />
                <Input
                  value={memberQuery}
                  onChange={(e) => setMemberQuery(e.target.value)}
                  placeholder={t('group.wizard.searchMember')}
                  className="h-8 pl-7 text-[12px]"
                />
              </div>
              <ScrollArea className="h-[200px] rounded-[8px] border border-border/70">
                {candidates.length === 0 ? (
                  <div className="py-12 text-center text-[12px] text-muted-foreground">
                    {t('empty.title')}
                  </div>
                ) : (
                  <ul className="grid gap-0.5 p-1.5">
                    {candidates.map((a) => (
                      <li key={a.id}>
                        <label className="flex cursor-pointer items-center gap-2 rounded-[7px] px-2 py-1.5 hover:bg-muted/60">
                          <Checkbox
                            checked={memberIds.has(a.id)}
                            onCheckedChange={() => toggleMember(a.id)}
                          />
                          <span className="min-w-0 flex-1 truncate text-[12px]">
                            {a.name || a.displayIdentifier || a.email}
                          </span>
                          <Badge variant="outline" className="h-4 shrink-0 px-1 text-[10px]">
                            {a.platform}
                          </Badge>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </ScrollArea>
              <p className="text-[11.5px] text-muted-foreground">
                {t('group.wizard.memberSelected', { count: memberIds.size })}
              </p>
            </div>
          ) : (
            <div className="grid gap-3">
              <p className="text-[12px] text-muted-foreground">{t('group.binding.title')}</p>
              <SegmentedOptions
                items={[
                  { value: 'none', label: t('group.binding.none') },
                  { value: 'proxy', label: t('group.binding.proxy') },
                ]}
                value={bindMode}
                onChange={(v) => setBindMode(v as BindingMode)}
                fullWidth
              />
              {bindMode === 'proxy' ? (
                <>
                  <Select value={bindProxyId} onValueChange={setBindProxyId}>
                    <SelectTrigger className="h-9 rounded-[8px]">
                      <SelectValue placeholder={t('group.binding.selectProxy')} />
                    </SelectTrigger>
                    <SelectContent>
                      {proxies.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.label || p.displayUrl}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="rounded-[8px] border border-border/70 bg-muted/30 px-3 py-2 text-[11.5px] text-muted-foreground">
                    {t('group.binding.proxyHint')}
                  </div>
                </>
              ) : null}
              {bindMode === 'none' ? (
                <div className="rounded-[8px] border border-border/70 bg-muted/30 px-3 py-2 text-[11.5px] text-muted-foreground">
                  {t('group.binding.noneHint')}
                </div>
              ) : null}
            </div>
          )}
        </div>

        {/* Footer nav */}
        <div className="flex items-center justify-between border-t border-border/70 pt-3">
          <Button
            variant="ghost"
            onClick={() => (step === 1 ? onOpenChange(false) : setStep((s) => s - 1))}
            disabled={busy}
          >
            {step === 1 ? (
              t('group.cancel')
            ) : (
              <>
                <ChevronLeft className="size-4" /> {t('group.wizard.back')}
              </>
            )}
          </Button>
          {step < 3 ? (
            <Button
              onClick={() => setStep((s) => s + 1)}
              disabled={(step === 1 && !canProceedStep1) || busy}
            >
              {t('group.wizard.next')} <ChevronRight className="size-4" />
            </Button>
          ) : (
            <Button onClick={() => void finish()} disabled={busy}>
              {busy ? t('edit.saving') : t('group.wizard.finish')}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
