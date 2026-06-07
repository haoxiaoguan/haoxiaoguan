// 编辑供应商弹窗:从 profile 预填,key 留空则不改;回写完整 settings(保留 uiMeta 与功能键)。
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { ProviderBrandIcon } from './ProviderBrandIcon';
import { CLIENT_EXTRA_FIELD, CLIENT_NATIVE_PROTOCOL_UI, UPSTREAM_PROTOCOL_OPTIONS } from './provider-templates';
import type { ClientConfigProfileDto, UpdateClientConfigProfileDto } from '@shared/api-types';

export function EditProviderDialog({
  profile,
  open,
  onOpenChange,
  onSave,
}: {
  profile: ClientConfigProfileDto | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSave: (id: string, patch: UpdateClientConfigProfileDto) => Promise<void>;
}) {
  const { t } = useTranslation('nav');
  const clientId = profile?.clientId ?? 'claude';
  const extra = CLIENT_EXTRA_FIELD[clientId];
  const nativeProtoUi = CLIENT_NATIVE_PROTOCOL_UI[clientId];

  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [extraValue, setExtraValue] = useState('');
  const [upstreamProtocol, setUpstreamProtocol] = useState('');
  const [routeViaProxy, setRouteViaProxy] = useState(false);
  const [busy, setBusy] = useState(false);

  const mismatch = nativeProtoUi !== undefined && upstreamProtocol !== nativeProtoUi;
  const uiMeta = (profile?.settings?.uiMeta ?? {}) as { icon?: string; iconColor?: string };

  // 打开/切换被编辑档时,从 profile 预填。
  useEffect(() => {
    if (!open || !profile) return;
    const s = (profile.settings ?? {}) as Record<string, unknown>;
    const ex = CLIENT_EXTRA_FIELD[profile.clientId];
    const proto = CLIENT_NATIVE_PROTOCOL_UI[profile.clientId];
    setName(profile.name);
    setBaseUrl(profile.baseUrl);
    setApiKey('');
    setModel(profile.model ?? '');
    setExtraValue((s[ex?.key ?? ''] as string | undefined) ?? ex?.default ?? '');
    setUpstreamProtocol((s.upstreamProtocol as string | undefined) ?? proto ?? '');
    setRouteViaProxy(s.routeViaProxy === true);
  }, [open, profile]);

  // 协议不匹配时强制开启路由(不可关)。
  useEffect(() => {
    if (mismatch) setRouteViaProxy(true);
  }, [mismatch]);

  const canSubmit = name.trim().length > 0 && baseUrl.trim().length > 0 && !busy;
  const submit = async () => {
    if (!canSubmit || !profile) return;
    setBusy(true);
    try {
      // 从原 settings 起改,保留 uiMeta 与其它未知键,再覆盖功能键。
      const nextSettings: Record<string, unknown> = { ...(profile.settings ?? {}) };
      if (extra) nextSettings[extra.key] = extraValue;
      if (nativeProtoUi) {
        nextSettings.upstreamProtocol = upstreamProtocol;
        nextSettings.routeViaProxy = routeViaProxy;
      }
      await onSave(profile.id, {
        name: name.trim(),
        baseUrl: baseUrl.trim(),
        model: model.trim() ? model.trim() : null,
        settings: nextSettings,
        // key 留空 = 不修改;后端 apiKey 省略时保留原 key_enc。
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      });
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ProviderBrandIcon icon={uiMeta.icon} iconColor={uiMeta.iconColor} name={name || profile?.name || '?'} />
            {t('clientConfigPage.form.editTitleFor', { name: profile?.name ?? '' })}
          </DialogTitle>
          <DialogDescription>{t('clientConfigPage.form.thirdPartyHint')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-1">
          <label className="text-[12px] font-medium text-muted-foreground">
            {t('clientConfigPage.form.name')}
            <Input className="mt-1" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('clientConfigPage.form.namePlaceholder')} />
          </label>
          <label className="text-[12px] font-medium text-muted-foreground">
            {t('clientConfigPage.form.baseUrl')}
            <Input className="mt-1 font-mono" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.example.com/v1" />
          </label>
          <label className="text-[12px] font-medium text-muted-foreground">
            {t('clientConfigPage.form.apiKey')}
            <Input className="mt-1 font-mono" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={t('clientConfigPage.form.apiKeyKeepPlaceholder')} />
          </label>
          <label className="text-[12px] font-medium text-muted-foreground">
            {t('clientConfigPage.form.model')}
            <Input className="mt-1 font-mono" value={model} onChange={(e) => setModel(e.target.value)} placeholder="deepseek-chat" />
          </label>

          {extra && (
            <label className="text-[12px] font-medium text-muted-foreground">
              {extra.label}
              <Select value={extraValue} onValueChange={setExtraValue}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {extra.options.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          )}

          {nativeProtoUi && (
            <label className="text-[12px] font-medium text-muted-foreground">
              {t('clientConfigPage.form.upstreamProtocol')}
              <Select value={upstreamProtocol} onValueChange={setUpstreamProtocol}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {UPSTREAM_PROTOCOL_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-[11px] text-muted-foreground/70">{t('clientConfigPage.form.upstreamProtocolHint')}</p>
            </label>
          )}

          {nativeProtoUi && (
            <div className="rounded-[8px] border border-border/60 px-3 py-2.5">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[12px] font-medium text-foreground">{t('clientConfigPage.form.routing')}</span>
                <Switch checked={routeViaProxy} disabled={mismatch} onCheckedChange={setRouteViaProxy} aria-label={t('clientConfigPage.form.routing')} />
              </div>
              {mismatch ? (
                <p className="mt-1.5 text-[11px] text-destructive">{t('clientConfigPage.form.routingForcedHint')}</p>
              ) : (
                <p className="mt-1.5 text-[11px] text-muted-foreground/70">{t('clientConfigPage.form.routingHint')}</p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('clientConfigPage.form.cancel')}
          </Button>
          <Button disabled={!canSubmit} onClick={() => void submit()}>
            {t('clientConfigPage.form.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
