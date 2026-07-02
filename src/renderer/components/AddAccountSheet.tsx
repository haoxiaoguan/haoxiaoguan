/**
 * AddAccountSheet — 账号导入入口弹窗（用真 shadcn 组件）。
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SegmentedOptions } from '@/components/ui/segmented-options';
import { BentoInnerPanel } from '@/components/ui/bento-inner-panel';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  credentialService,
  type ImportedCredentialMaterial,
  type OAuthMode,
} from '../services/tauri';
import { useAccountStore, usePlatformStore, useOnboardingStore, useAccountGroupStore } from '../stores';
import { useProxyStore } from '../stores/proxyStore';
import type { OnboardingMethod } from '../stores/onboardingStore';
import { parseUnifiedBatch } from '../lib/parseCredentialBatch';
import type { PlatformId } from '../types';

// Sentinel for "not assigned / not bound" in the group/proxy selects (same value
// as EditAccountDialog so behavior matches).
const NONE = '__none__';

interface AddAccountSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultPlatform?: PlatformId;
  onSuccess: () => void;
}

function toBackendPlatform(p: PlatformId): string {
  return p.replace(/-/g, '_');
}

function shouldShowUserIdLabel(material: ImportedCredentialMaterial) {
  return material.provider === 'kiro' && !material.email.includes('@');
}

async function openExternalUrl(url: string) {
  try {
    const { bridge } = await import('../services/bridge');
    await bridge().shellOpen(url);
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

export default function AddAccountSheet({
  open,
  onOpenChange,
  defaultPlatform,
  onSuccess,
}: AddAccountSheetProps) {
  const { t } = useTranslation('onboarding');
  const { importAccount } = useAccountStore();
  const { getDisplayName } = usePlatformStore();
  const onboarding = useOnboardingStore();

  const groups = useAccountGroupStore((s) => s.groups);
  const fetchGroups = useAccountGroupStore((s) => s.fetchGroups);
  const addMembers = useAccountGroupStore((s) => s.addMembers);
  const proxies = useProxyStore((s) => s.proxies);
  const fetchProxies = useProxyStore((s) => s.fetchAll);
  const bindAccountToProxy = useProxyStore((s) => s.bindAccountToProxy);

  const platform = defaultPlatform || 'kiro';
  const [method, setMethod] = useState<OnboardingMethod>('oauth');
  const [batchText, setBatchText] = useState('');
  const [batchResult, setBatchResult] = useState<{
    total: number;
    success: number;
    failed: number;
    errors: string[];
  } | null>(null);
  // Group / proxy to bind every imported account to (NONE = leave unbound).
  const [groupId, setGroupId] = useState<string>(NONE);
  const [proxyId, setProxyId] = useState<string>(NONE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [material, setMaterial] = useState<ImportedCredentialMaterial | null>(null);

  const reset = () => {
    setError(null);
    setMaterial(null);
    setBatchResult(null);
    setBusy(false);
  };

  useEffect(() => {
    if (!open) return;
    setMethod('oauth');
    setBatchText('');
    setGroupId(NONE);
    setProxyId(NONE);
    void fetchGroups();
    void fetchProxies();
    reset();
  }, [open, platform, fetchGroups, fetchProxies]);

  const closeAndReset = (next: boolean) => {
    if (!next) {
      reset();
      onboarding.reset();
      setMethod('oauth');
      setBatchText('');
      setGroupId(NONE);
      setProxyId(NONE);
    }
    onOpenChange(next);
  };

  // Bind a freshly-imported account to the selected group / proxy. The account
  // already exists, so a binding failure must not fail the import — surface it
  // as a soft warning and let the user fix it later in the edit dialog.
  const applyBindings = async (accountId: string): Promise<string | null> => {
    try {
      if (groupId !== NONE) await addMembers(groupId, [accountId]);
      if (proxyId !== NONE) await bindAccountToProxy(accountId, proxyId);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  };

  const startMethod = async () => {
    reset();
    setBusy(true);
    onboarding.start(platform, method);
    try {
      const backendPlatform = toBackendPlatform(platform);
      switch (method) {
        case 'oauth': {
          const mode: OAuthMode = 'loopback_pkce';
          const pending = await credentialService.startOAuth(backendPlatform, mode);
          onboarding.setPending(pending);
          await openExternalUrl(pending.authorize_url);
          // 导入新账号：把 OAuth 换 token 经 UI 选定的代理路由（避免暴露真实 IP）。
          const m = await credentialService.completeOAuth(
            pending.pending_id,
            '',
            proxyId !== NONE ? proxyId : undefined,
          );
          setMaterial(m);
          onboarding.setMaterial(m);
          // OAuth 授权成功即代表用户已确认，直接入库并关闭弹窗（不再需要二次「确认」）。
          // 本地扫描/批量仍保留预览确认。
          await importMaterial(m);
          break;
        }
        case 'local_scan': {
          const list = await credentialService.scanLocalCredentials(backendPlatform, proxyId !== NONE ? proxyId : undefined);
          if (list.length === 0) throw new Error('no local credential found');
          setMaterial(list[0]);
          onboarding.setMaterial(list[0]);
          break;
        }
      }
    } catch (e) {
      const msg = String(e);
      setError(msg);
      onboarding.fail(msg);
    } finally {
      setBusy(false);
    }
  };

  // 由物料创建账号并收尾（绑定分组/代理 → 关闭弹窗）。OAuth 授权后自动调用；
  // 本地扫描/单条预览走「确认」按钮调用。抛错交由调用方 setError 展示。
  const importMaterial = async (m: ImportedCredentialMaterial) => {
    const account = await importAccount({
      platform: m.provider,
      email: m.email,
      token: m.access_token,
      refreshToken: m.refresh_token,
      expiresAt: m.expires_at,
      rawMetadata: m.raw_metadata,
      tags: [],
    });
    const bindErr = await applyBindings(account.id);
    onboarding.finish();
    onSuccess();
    closeAndReset(false);
    if (bindErr) toast.warning(t('binding.failed'), { description: bindErr });
  };

  const commitImport = async () => {
    if (!material) return;
    setBusy(true);
    setError(null);
    try {
      await importMaterial(material);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  // Unified import: one textarea auto-detects single token JSON / JSON array /
  // card-key rows (parseUnifiedBatch), then runs each entry through the same
  // single-account path (importTokenJson → importAccount) so every account gets
  // online identity confirmation. Serial, error-isolated, with a result summary.
  // Unparsable entries count as failures up front.
  const runBatchImport = async () => {
    const { items, invalid } = parseUnifiedBatch(batchText);
    if (items.length === 0 && invalid.length === 0) {
      setError(t('batch.empty'));
      return;
    }
    setBusy(true);
    setError(null);
    setBatchResult(null);
    const result = {
      total: items.length + invalid.length,
      success: 0,
      failed: invalid.length,
      errors: [...invalid],
    };
    const backendPlatform = toBackendPlatform(platform);
    for (let i = 0; i < items.length; i += 1) {
      const { payload, label } = items[i];
      try {
        const m = await credentialService.importTokenJson(backendPlatform, payload, proxyId !== NONE ? proxyId : undefined);
        const account = await importAccount({
          platform: m.provider,
          email: m.email,
          token: m.access_token,
          refreshToken: m.refresh_token,
          expiresAt: m.expires_at,
          rawMetadata: m.raw_metadata,
          tags: [],
        });
        result.success += 1;
        // Account is imported; a binding failure is a soft warning, not a row failure.
        const bindErr = await applyBindings(account.id);
        if (bindErr) result.errors.push(`${label} (${t('binding.failed')}): ${bindErr}`);
      } catch (e) {
        result.failed += 1;
        result.errors.push(`${label}: ${String(e)}`);
      }
    }
    setBatchResult(result);
    setBusy(false);
    if (result.success > 0) onSuccess();
  };

  const methodItems: ReadonlyArray<{ value: OnboardingMethod; label: string }> = [
    { value: 'oauth', label: t('method.oauth') },
    { value: 'token_batch', label: t('method.token_batch') },
    { value: 'local_scan', label: t('method.local_scan') },
  ];
  const platformDisplayName = getDisplayName(platform);

  return (
    <Dialog open={open} onOpenChange={closeAndReset}>
      <DialogContent className="max-h-[calc(100vh-4rem)] overflow-y-auto p-5 sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>添加 {platformDisplayName} 账号</DialogTitle>
          <DialogDescription>{t('step.method_select')}</DialogDescription>
        </DialogHeader>

        <div className="mt-4 space-y-4">
          {/* 导入方式 segmented */}
          <div className="space-y-2">
            <div className="text-[13px] font-medium text-foreground">
              {t('step.method_select')}
            </div>
            <SegmentedOptions
              items={methodItems}
              value={method}
              fullWidth
              onChange={(v) => {
                setMethod(v as OnboardingMethod);
                reset();
              }}
            />
          </div>

          {/* 分组 / 代理绑定（所有导入方式共用；导入成功后统一绑定） */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[12px] text-muted-foreground">{t('binding.group')}</label>
              <Select value={groupId} onValueChange={setGroupId} disabled={busy}>
                <SelectTrigger className="h-9 rounded-[8px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t('binding.groupNone')}</SelectItem>
                  {groups.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-[12px] text-muted-foreground">{t('binding.proxy')}</label>
              <Select value={proxyId} onValueChange={setProxyId} disabled={busy}>
                <SelectTrigger className="h-9 rounded-[8px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t('binding.proxyNone')}</SelectItem>
                  {proxies.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.label || p.displayUrl}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* 方式特定输入 */}
          {method === 'token_batch' && (
            <div className="space-y-2">
              <label className="text-[13px] font-medium text-foreground">
                {t('method.token_batch')}
              </label>
              <Textarea
                placeholder={t('batch.placeholder')}
                value={batchText}
                onChange={(e) => setBatchText(e.target.value)}
                disabled={busy}
                className="min-h-[140px] font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">{t('batch.hint')}</p>
              {batchResult && (
                <BentoInnerPanel className="space-y-1.5 text-xs">
                  <div className="font-medium text-foreground">
                    {t('batch.result', {
                      success: batchResult.success,
                      failed: batchResult.failed,
                      total: batchResult.total,
                    })}
                  </div>
                  {batchResult.errors.length > 0 && (
                    <ul className="max-h-[120px] space-y-1 overflow-y-auto text-red-600 dark:text-red-400">
                      {batchResult.errors.map((msg, i) => (
                        <li key={i} className="break-all">{msg}</li>
                      ))}
                    </ul>
                  )}
                </BentoInnerPanel>
              )}
            </div>
          )}
          {method === 'oauth' && (
            <BentoInnerPanel className="text-xs text-muted-foreground">
              {t('step.oauth_pending')}
            </BentoInnerPanel>
          )}
          {method === 'local_scan' && (
            <BentoInnerPanel className="text-xs text-muted-foreground">
              {t('step.collecting_input')}
            </BentoInnerPanel>
          )}

          {/* 物料预览 */}
          {material && (
            <BentoInnerPanel className="space-y-1.5 text-sm">
              <div className="text-[13px] font-medium text-foreground">{t('step.reviewing')}</div>
              <div className="text-xs text-muted-foreground">
                <div>
                  {shouldShowUserIdLabel(material) ? t('review.user_id') : t('review.email')}:{' '}
                  <span className="text-foreground">{material.email}</span>
                </div>
                <div>source: <span className="text-foreground">{material.source}</span></div>
                {material.expires_at && (
                  <div>expires: <span className="text-foreground">{material.expires_at}</span></div>
                )}
              </div>
            </BentoInnerPanel>
          )}

          {error && (
            <div className="rounded-md border border-red-500/40 bg-red-500/5 px-3 py-2 text-xs text-red-700 dark:text-red-400">
              <span className="font-medium">{t('step.failed')}:</span> {error}
            </div>
          )}
        </div>

        <DialogFooter className="mt-6">
          <Button variant="ghost" size="sm" onClick={() => closeAndReset(false)} disabled={busy}>
            {t('actions.cancel')}
          </Button>
          {method === 'token_batch' ? (
            <Button size="sm" onClick={runBatchImport} disabled={busy || !batchText.trim()}>
              {busy ? t('batch.importing') : t('batch.run')}
            </Button>
          ) : !material ? (
            <Button size="sm" onClick={startMethod} disabled={busy}>
              {method === 'oauth' ? t('actions.open_browser') : t('actions.confirm')}
            </Button>
          ) : (
            <Button size="sm" onClick={commitImport} disabled={busy}>
              {t('actions.confirm')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
