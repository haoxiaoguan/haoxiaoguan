/**
 * AddAccountSheet — 账号导入入口弹窗（用真 shadcn 组件）。
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  credentialService,
  type ImportedCredentialMaterial,
  type OAuthMode,
} from '../services/tauri';
import { useAccountStore, usePlatformStore, useOnboardingStore } from '../stores';
import type { OnboardingMethod } from '../stores/onboardingStore';
import type { PlatformId } from '../types';

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

  const platform = defaultPlatform || 'kiro';
  const [method, setMethod] = useState<OnboardingMethod>('oauth');
  const [tokenJson, setTokenJson] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [material, setMaterial] = useState<ImportedCredentialMaterial | null>(null);

  const reset = () => {
    setError(null);
    setMaterial(null);
    setBusy(false);
  };

  useEffect(() => {
    if (!open) return;
    setMethod('oauth');
    setTokenJson('');
    reset();
  }, [open, platform]);

  const closeAndReset = (next: boolean) => {
    if (!next) {
      reset();
      onboarding.reset();
      setMethod('oauth');
      setTokenJson('');
    }
    onOpenChange(next);
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
          const m = await credentialService.completeOAuth(pending.pending_id, '');
          setMaterial(m);
          onboarding.setMaterial(m);
          break;
        }
        case 'token_json': {
          if (!tokenJson.trim()) throw new Error('empty payload');
          const m = await credentialService.importTokenJson(backendPlatform, tokenJson);
          setMaterial(m);
          onboarding.setMaterial(m);
          break;
        }
        case 'local_scan': {
          const list = await credentialService.scanLocalCredentials(backendPlatform);
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

  const commitImport = async () => {
    if (!material) return;
    setBusy(true);
    setError(null);
    try {
      await importAccount({
        platform: material.provider,
        email: material.email,
        token: material.access_token,
        refreshToken: material.refresh_token,
        expiresAt: material.expires_at,
        rawMetadata: material.raw_metadata,
        tags: [],
      });
      onboarding.finish();
      onSuccess();
      closeAndReset(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const methodItems: ReadonlyArray<{ value: OnboardingMethod; label: string }> = [
    { value: 'oauth', label: t('method.oauth') },
    { value: 'token_json', label: t('method.token_json') },
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

          {/* 方式特定输入 */}
          {method === 'token_json' && (
            <div className="space-y-2">
              <label className="text-[13px] font-medium text-foreground">Token JSON</label>
              <Textarea
                placeholder='{"access_token": "...", "refresh_token": "..."}'
                value={tokenJson}
                onChange={(e) => setTokenJson(e.target.value)}
                disabled={busy}
                className="min-h-[120px] font-mono text-xs"
              />
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
          {!material ? (
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
