// 编辑供应商:作为右侧页面(非弹窗)。从 profile 预填,key 留空则不改;回写完整 settings(保留 uiMeta 与功能键)。
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Download } from 'lucide-react';
import { toast } from 'sonner';
import { bridge } from '../../services/bridge';
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
import { ConfigPreview } from './ConfigPreview';
import { ModelCombobox } from './ModelCombobox';
import { ClaudeModelMapFields, EMPTY_MODEL_MAP, type ModelMap, type ModelTier } from './ClaudeModelMapFields';
import { CLIENT_EXTRA_FIELD, CLIENT_NATIVE_PROTOCOL_UI, UPSTREAM_PROTOCOL_OPTIONS } from './provider-templates';
import type { ClientConfigProfileDto, UpdateClientConfigProfileDto } from '@shared/api-types';

export function EditProviderDialog({
  profile,
  onBack,
  onSave,
}: {
  profile: ClientConfigProfileDto;
  /** 返回列表。 */
  onBack: () => void;
  onSave: (id: string, patch: UpdateClientConfigProfileDto) => Promise<void>;
}) {
  const { t } = useTranslation('nav');
  const clientId = profile.clientId;
  const extra = CLIENT_EXTRA_FIELD[clientId];
  const nativeProtoUi = CLIENT_NATIVE_PROTOCOL_UI[clientId];

  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [extraValue, setExtraValue] = useState('');
  const [upstreamProtocol, setUpstreamProtocol] = useState('');
  const [routeViaProxy, setRouteViaProxy] = useState(false);
  const [modelMap, setModelMap] = useState<ModelMap>(EMPTY_MODEL_MAP);
  const [models, setModels] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [busy, setBusy] = useState(false);

  const doFetchModels = async () => {
    if (baseUrl.trim().length === 0 || fetchingModels) return;
    setFetchingModels(true);
    try {
      const list = await bridge().clientConfig.fetchModels({
        clientId,
        baseUrl: baseUrl.trim(),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        profileId: profile.id,
      });
      setModels(list);
      toast.success(
        list.length > 0
          ? t('clientConfigPage.form.fetchModelsDone', { count: list.length })
          : t('clientConfigPage.form.fetchModelsEmpty'),
      );
    } catch (e) {
      toast.error(t('clientConfigPage.form.fetchModelsFailed', { msg: e instanceof Error ? e.message : String(e) }));
    } finally {
      setFetchingModels(false);
    }
  };

  const mismatch = nativeProtoUi !== undefined && upstreamProtocol !== nativeProtoUi;
  const uiMeta = (profile.settings?.uiMeta ?? {}) as { icon?: string; iconColor?: string };

  // 配置预览源码编辑回写(仅 Claude settings.json):解析 env.* → 表单字段。
  const applyClaudeConfigEdit = (text: string): boolean => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return false;
    }
    if (typeof parsed !== 'object' || parsed === null) return false;
    const env = (parsed as { env?: unknown }).env;
    if (typeof env !== 'object' || env === null) return false;
    const e = env as Record<string, unknown>;
    const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
    const bu = str(e.ANTHROPIC_BASE_URL);
    if (bu !== undefined) setBaseUrl(bu);
    const tok = str(e.ANTHROPIC_AUTH_TOKEN);
    if (tok !== undefined && tok.length > 0) setApiKey(tok); // 空不覆盖,保留原 key
    setModel(str(e.ANTHROPIC_MODEL) ?? '');
    setModelMap({
      haiku: { model: str(e.ANTHROPIC_DEFAULT_HAIKU_MODEL) ?? '', name: str(e.ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME) ?? '' },
      sonnet: { model: str(e.ANTHROPIC_DEFAULT_SONNET_MODEL) ?? '', name: str(e.ANTHROPIC_DEFAULT_SONNET_MODEL_NAME) ?? '' },
      opus: { model: str(e.ANTHROPIC_DEFAULT_OPUS_MODEL) ?? '', name: str(e.ANTHROPIC_DEFAULT_OPUS_MODEL_NAME) ?? '' },
    });
    return true;
  };

  // Claude 分级模型映射:仅保留有 model 或 name 的档位。
  const modelMapClean: Record<string, { model?: string; name?: string }> = {};
  if (clientId === 'claude') {
    for (const tier of ['haiku', 'sonnet', 'opus'] as const) {
      const m = modelMap[tier].model.trim();
      const n = modelMap[tier].name.trim();
      if (m || n) modelMapClean[tier] = { ...(m ? { model: m } : {}), ...(n ? { name: n } : {}) };
    }
  }

  // 从原 settings 起改,保留 uiMeta 与其它未知键,再覆盖功能键。预览与保存共用。
  const draftSettings: Record<string, unknown> = {
    ...((profile.settings ?? {}) as Record<string, unknown>),
    ...(extra ? { [extra.key]: extraValue } : {}),
    ...(nativeProtoUi ? { upstreamProtocol, routeViaProxy } : {}),
  };
  if (clientId === 'claude') {
    if (Object.keys(modelMapClean).length > 0) draftSettings.modelMap = modelMapClean;
    else delete draftSettings.modelMap;
  }

  // 进入编辑(或切换被编辑档)时,从 profile 预填。
  useEffect(() => {
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
    const mm = (typeof s.modelMap === 'object' && s.modelMap !== null ? s.modelMap : {}) as Record<string, unknown>;
    const readTier = (v: unknown): ModelTier => {
      if (typeof v === 'string') return { model: v, name: '' }; // 旧版:值为模型字符串
      if (typeof v === 'object' && v !== null) {
        const o = v as Record<string, unknown>;
        return { model: typeof o.model === 'string' ? o.model : '', name: typeof o.name === 'string' ? o.name : '' };
      }
      return { model: '', name: '' };
    };
    setModelMap({ haiku: readTier(mm.haiku), sonnet: readTier(mm.sonnet), opus: readTier(mm.opus) });
    setModels([]);
  }, [profile]);

  // 协议不匹配时强制开启路由(不可关)。
  useEffect(() => {
    if (mismatch) setRouteViaProxy(true);
  }, [mismatch]);

  const canSubmit = name.trim().length > 0 && baseUrl.trim().length > 0 && !busy;
  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      await onSave(profile.id, {
        name: name.trim(),
        baseUrl: baseUrl.trim(),
        model: model.trim() ? model.trim() : null,
        settings: draftSettings,
        // key 留空 = 不修改;后端 apiKey 省略时保留原 key_enc。
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      });
      onBack();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 头部:返回 + 标题 */}
      <div className="flex min-w-0 items-center gap-2.5 border-b border-border/60 px-5 py-3">
        <Button variant="outline" size="icon" className="size-8 shrink-0 rounded-lg" onClick={onBack} aria-label={t('clientConfigPage.form.back')}>
          <ArrowLeft className="size-4" aria-hidden />
        </Button>
        <ProviderBrandIcon icon={uiMeta.icon} iconColor={uiMeta.iconColor} name={name || profile.name || '?'} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold text-foreground">{t('clientConfigPage.form.editTitleFor', { name: profile.name })}</div>
          <div className="truncate text-[11.5px] text-muted-foreground">{t('clientConfigPage.form.thirdPartyHint')}</div>
        </div>
      </div>

      {/* 滚动表单体 */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
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
        <div className="text-[12px] font-medium text-muted-foreground">
          <div className="flex items-center justify-between">
            <span>{t('clientConfigPage.form.model')}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={fetchingModels || baseUrl.trim().length === 0}
              className="h-6 gap-1 text-[11px]"
              onClick={() => void doFetchModels()}
            >
              <Download className="size-3" aria-hidden />
              {t('clientConfigPage.form.fetchModels')}
            </Button>
          </div>
          <div className="mt-1">
            <ModelCombobox value={model} options={models} onChange={setModel} placeholder="deepseek-chat" />
          </div>
        </div>

        {clientId === 'claude' && (
          <ClaudeModelMapFields
            value={modelMap}
            options={models}
            onTierChange={(tier, patch) => setModelMap((prev) => ({ ...prev, [tier]: { ...prev[tier], ...patch } }))}
          />
        )}

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

        <ConfigPreview
          clientId={clientId}
          name={name}
          baseUrl={baseUrl}
          apiKey={apiKey}
          model={model}
          settings={draftSettings}
          footNote={nativeProtoUi && (mismatch || routeViaProxy) ? t('clientConfigPage.form.previewRelayNote') : undefined}
          onApplyEdit={clientId === 'claude' ? applyClaudeConfigEdit : undefined}
        />
      </div>

      {/* 底部操作 */}
      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border/60 px-5 py-3">
        <Button variant="outline" onClick={onBack}>
          {t('clientConfigPage.form.cancel')}
        </Button>
        <Button disabled={!canSubmit} onClick={() => void submit()}>
          {t('clientConfigPage.form.save')}
        </Button>
      </div>
    </div>
  );
}
