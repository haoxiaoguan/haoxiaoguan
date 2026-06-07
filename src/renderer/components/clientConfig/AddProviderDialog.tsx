// 添加供应商弹窗(每客户端模板不同):预设选择 + 公共字段 + 该客户端专属字段。
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
import { ClientLogo } from './ClientLogo';
import { CLIENT_EXTRA_FIELD, CLIENT_PRESETS, CLIENT_NATIVE_PROTOCOL_UI, UPSTREAM_PROTOCOL_OPTIONS } from './provider-templates';
import type { ClientConfigClientId } from '@shared/api-types';

export interface AddProviderValue {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  settings?: Record<string, string>;
}

const CUSTOM = 'custom';

export function AddProviderDialog({
  clientId,
  clientName,
  open,
  onOpenChange,
  onCreate,
}: {
  clientId: ClientConfigClientId;
  clientName: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreate: (v: AddProviderValue) => Promise<void>;
}) {
  const { t } = useTranslation('nav');
  const extra = CLIENT_EXTRA_FIELD[clientId];
  const nativeProtoUi = CLIENT_NATIVE_PROTOCOL_UI[clientId];
  const presets = CLIENT_PRESETS[clientId] ?? [];

  const [presetId, setPresetId] = useState(CUSTOM);
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [extraValue, setExtraValue] = useState(extra?.default ?? '');
  const [upstreamProtocol, setUpstreamProtocol] = useState(nativeProtoUi ?? '');
  const [busy, setBusy] = useState(false);

  // 打开/切客户端时重置。
  useEffect(() => {
    if (open) {
      setPresetId(CUSTOM);
      setName('');
      setBaseUrl('');
      setApiKey('');
      setModel('');
      setExtraValue(CLIENT_EXTRA_FIELD[clientId]?.default ?? '');
      setUpstreamProtocol(CLIENT_NATIVE_PROTOCOL_UI[clientId] ?? '');
    }
  }, [open, clientId]);

  const onPickPreset = (id: string) => {
    setPresetId(id);
    if (id === CUSTOM) return;
    const p = presets.find((x) => x.id === id);
    if (!p) return;
    setName(p.label);
    setBaseUrl(p.baseUrl);
    setModel(p.model ?? '');
    const e = CLIENT_EXTRA_FIELD[clientId];
    if (e) setExtraValue((p.settings?.[e.key] as string | undefined) ?? e.default);
  };

  const canSubmit = name.trim().length > 0 && baseUrl.trim().length > 0 && !busy;
  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      await onCreate({
        name: name.trim(),
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
        model: model.trim(),
        settings: {
          ...(extra ? { [extra.key]: extraValue } : {}),
          ...(nativeProtoUi ? { upstreamProtocol } : {}),
        },
      });
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClientLogo clientId={clientId} className="size-6" imageClassName="size-3.5" />
            {t('clientConfigPage.form.createTitleFor', { client: clientName })}
          </DialogTitle>
          <DialogDescription>{t('clientConfigPage.form.thirdPartyHint')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-1">
          {presets.length > 0 && (
            <label className="text-[12px] font-medium text-muted-foreground">
              {t('clientConfigPage.form.preset')}
              <Select value={presetId} onValueChange={onPickPreset}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={CUSTOM}>{t('clientConfigPage.form.custom')}</SelectItem>
                  {presets.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          )}

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
            <Input className="mt-1 font-mono" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..." />
          </label>
          <label className="text-[12px] font-medium text-muted-foreground">
            {t('clientConfigPage.form.model')}
            <Input className="mt-1 font-mono" value={model} onChange={(e) => setModel(e.target.value)} placeholder="deepseek-chat" />
          </label>

          {/* 该客户端专属字段(Codex wire_api / OpenCode npm / OpenClaw api / Hermes api_mode) */}
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

          {/* 固定协议客户端(claude/codex/gemini_cli):上游协议选择 */}
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
              <p className="mt-1 text-[11px] text-muted-foreground/70">
                {t('clientConfigPage.form.upstreamProtocolHint')}
              </p>
            </label>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('clientConfigPage.form.cancel')}
          </Button>
          <Button disabled={!canSubmit} onClick={() => void submit()}>
            {t('clientConfigPage.form.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
