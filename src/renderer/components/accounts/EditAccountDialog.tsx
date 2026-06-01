import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAccountStore, useAccountGroupStore } from '../../stores';
import { useProxyStore } from '../../stores/proxyStore';
import { credentialService, accountGroupService, proxyService, type OAuthMode } from '../../services/tauri';
import type { Account } from '../../types';

interface EditAccountDialogProps {
  account: Account | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}

const NONE = '__none__';

/**
 * EditAccountDialog — edit user metadata (name / tags / notes), assign the
 * account to a single group, and bind it to a proxy. Identity-bearing fields
 * stay frozen; rotating credentials goes through "重新认证".
 *
 * Egress precedence (shown live as a hint): the account's own proxy wins; if
 * unbound, the account's group proxy applies; otherwise direct.
 */
function toBackendPlatform(p: string): string {
  return p.replace(/-/g, '_');
}

async function openExternalUrl(url: string) {
  try {
    const { bridge } = await import('../../services/bridge');
    await bridge().shellOpen(url);
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

export default function EditAccountDialog({
  account,
  open,
  onOpenChange,
  onSaved,
}: EditAccountDialogProps) {
  const { t } = useTranslation('accounts');
  const { t: tCommon } = useTranslation('translation');
  const updateAccount = useAccountStore((s) => s.updateAccount);
  const reauthenticate = useAccountStore((s) => s.reauthenticate);

  const groups = useAccountGroupStore((s) => s.groups);
  const fetchGroups = useAccountGroupStore((s) => s.fetchGroups);
  const addMembers = useAccountGroupStore((s) => s.addMembers);
  const removeMembers = useAccountGroupStore((s) => s.removeMembers);

  const proxies = useProxyStore((s) => s.proxies);
  const fetchProxies = useProxyStore((s) => s.fetchAll);
  const bindAccountToProxy = useProxyStore((s) => s.bindAccountToProxy);
  const unbindAccount = useProxyStore((s) => s.unbindAccount);

  const [name, setName] = useState('');
  const [tags, setTags] = useState('');
  const [notes, setNotes] = useState('');
  // Group + proxy selection. NONE sentinel = "not assigned / not bound".
  const [groupId, setGroupId] = useState<string>(NONE);
  const [initialGroupId, setInitialGroupId] = useState<string>(NONE);
  const [proxyId, setProxyId] = useState<string>(NONE);
  const [initialProxyId, setInitialProxyId] = useState<string>(NONE);
  const [busy, setBusy] = useState(false);
  const [reauthBusy, setReauthBusy] = useState(false);

  // Hydrate the form whenever a different account is opened.
  useEffect(() => {
    if (!open || !account) return;
    setName(account.name ?? '');
    setTags(account.tags.join(', '));
    setNotes(account.notes ?? '');
    // Load reference data + this account's current group/proxy.
    void fetchGroups();
    void fetchProxies();
    void accountGroupService.listGroupsForAccount(account.id).then((gs) => {
      const id = gs.length > 0 ? gs[0].id : NONE;
      setGroupId(id);
      setInitialGroupId(id);
    });
    void proxyService.getAccountBinding(account.id).then((b) => {
      const id = b?.proxyId ?? NONE;
      setProxyId(id);
      setInitialProxyId(id);
    });
  }, [account, open, fetchGroups, fetchProxies]);

  // Compute the live "effective egress" hint from the current selection.
  const egressHint = useMemo(() => {
    if (proxyId !== NONE) {
      const p = proxies.find((px) => px.id === proxyId);
      return t('edit.egressAccount', { label: p ? p.label || p.displayUrl : proxyId });
    }
    if (groupId !== NONE) {
      const g = groups.find((gr) => gr.id === groupId);
      const boundProxyId = g?.proxyBinding?.proxyId;
      if (boundProxyId) {
        const p = proxies.find((px) => px.id === boundProxyId);
        return t('edit.egressGroup', {
          group: g?.name ?? groupId,
          label: p ? p.label || p.displayUrl : boundProxyId,
        });
      }
      return t('edit.egressGroupUnbound', { group: g?.name ?? groupId });
    }
    return t('edit.egressDirect');
  }, [proxyId, groupId, proxies, groups, t]);

  const submit = async () => {
    if (!account) return;
    setBusy(true);
    try {
      const cleanTags = tags
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s !== '');
      await updateAccount(account.id, {
        name: name.trim() === '' ? null : name.trim(),
        tags: cleanTags,
        notes: notes.trim() === '' ? null : notes.trim(),
      });

      // Group membership change (single group; addMembers enforces the invariant).
      if (groupId !== initialGroupId) {
        if (groupId === NONE) {
          if (initialGroupId !== NONE) await removeMembers(initialGroupId, [account.id]);
        } else {
          await addMembers(groupId, [account.id]);
        }
      }

      // Proxy binding change.
      if (proxyId !== initialProxyId) {
        if (proxyId === NONE) await unbindAccount(account.id);
        else await bindAccountToProxy(account.id, proxyId);
      }

      toast.success(t('edit.saved'));
      onSaved?.();
      onOpenChange(false);
    } catch (e) {
      toast.error(t('edit.failed'), {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  };

  const handleReauth = async () => {
    if (!account) return;
    setReauthBusy(true);
    try {
      const backendPlatform = toBackendPlatform(account.platform);
      const mode: OAuthMode = 'loopback_pkce';
      const pending = await credentialService.startOAuth(backendPlatform, mode);
      await openExternalUrl(pending.authorize_url);
      const material = await credentialService.completeOAuth(pending.pending_id, '');
      await reauthenticate(account.id, {
        identifier: material.email,
        token: material.access_token,
        refreshToken: material.refresh_token,
        expiresAt: material.expires_at,
        rawMetadata: material.raw_metadata,
      });
      toast.success(t('reauth.success'));
      onSaved?.();
      onOpenChange(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const description = /Identity mismatch/i.test(msg) ? t('reauth.identityMismatch') : msg;
      toast.error(t('reauth.failed'), { description });
    } finally {
      setReauthBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>{t('edit.title')}</DialogTitle>
          <DialogDescription>{t('edit.description')}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-2">
          <div>
            <label className="text-[12px] text-muted-foreground">{t('edit.name')}</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={account?.displayIdentifier ?? account?.email ?? ''}
              disabled={busy}
            />
          </div>
          <div>
            <label className="text-[12px] text-muted-foreground">{t('edit.tags')}</label>
            <Input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="prod, us-east"
              disabled={busy}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">{t('edit.tagsHint')}</p>
          </div>
          <div>
            <label className="text-[12px] text-muted-foreground">{t('edit.notes')}</label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="min-h-[64px]"
              disabled={busy}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[12px] text-muted-foreground">{t('edit.belongsToGroup')}</label>
              <Select value={groupId} onValueChange={setGroupId} disabled={busy}>
                <SelectTrigger className="h-9 rounded-[8px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t('edit.noGroup')}</SelectItem>
                  {groups.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-[12px] text-muted-foreground">{t('edit.bindProxy')}</label>
              <Select value={proxyId} onValueChange={setProxyId} disabled={busy}>
                <SelectTrigger className="h-9 rounded-[8px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t('edit.noProxy')}</SelectItem>
                  {proxies.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.label || p.displayUrl}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="rounded-[8px] border border-border/70 bg-muted/30 px-3 py-2 text-[11.5px]">
            <span className="text-muted-foreground">{t('edit.effectiveEgress')}：</span>
            <span className="font-medium text-foreground">{egressHint}</span>
          </div>

          <div className="rounded-[8px] border border-border/70 bg-muted/30 px-3 py-2 text-[11.5px] text-muted-foreground">
            <div>
              {t('edit.identity')}:{' '}
              <span className="font-mono text-foreground">
                {account?.displayIdentifier ?? account?.email ?? '—'}
              </span>
            </div>
            <div className="mt-0.5">{t('edit.identityHint')}</div>
          </div>
        </div>

        <DialogFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <Button
            variant="outline"
            onClick={() => void handleReauth()}
            disabled={busy || reauthBusy}
          >
            {reauthBusy ? t('edit.saving') : t('reauth.title')}
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy || reauthBusy}>
              {tCommon('common.cancel')}
            </Button>
            <Button onClick={() => void submit()} disabled={busy || reauthBusy}>
              {busy ? t('edit.saving') : t('edit.save')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
