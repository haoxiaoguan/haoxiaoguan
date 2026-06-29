// 编辑供应商:作为右侧页面(非弹窗)。从 profile 预填,key 留空则不改;回写完整 settings(保留 uiMeta 与功能键)。
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Download, Link2, Lightbulb } from 'lucide-react';
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
import { CodexModelListFields, type CodexModelItem } from './CodexModelListFields';
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
  const isClaudeFamily = clientId === 'claude' || clientId === 'claude_desktop';

  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  // 「完整 URL」：开=原样用 baseUrl(不补 /v1);关=按基址自动补 /v1。
  const [fullUrl, setFullUrl] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [extraValue, setExtraValue] = useState('');
  const [upstreamProtocol, setUpstreamProtocol] = useState('');
  const [modelMap, setModelMap] = useState<ModelMap>(EMPTY_MODEL_MAP);
  const [codexModels, setCodexModels] = useState<CodexModelItem[]>([]);
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
        ...(fullUrl ? { fullUrl: true } : {}),
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

  // 协议不匹配 → 启用时必须开「路由」经反代转换（硬门槛，由列表页处理）。
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

  // 配置预览源码编辑回写(Codex config.toml):正则提取注入的 [model_providers.hxg_*] / [profiles.hxg_*] 段 → 表单。
  const applyCodexConfigEdit = (text: string): boolean => {
    const grabIn = (block: string, key: string): string | undefined => {
      const m = block.match(new RegExp(`^\\s*${key}\\s*=\\s*["']([^"'\\n]*)["']`, 'm'));
      return m ? m[1] : undefined;
    };
    const prov = text.match(/\[model_providers\.hxg_[^\]]*\]([\s\S]*?)(?=\n\[|$)/);
    if (!prov) return false;
    const prof = text.match(/\[profiles\.hxg_[^\]]*\]([\s\S]*?)(?=\n\[|$)/);
    const bu = grabIn(prov[1], 'base_url');
    const tok = grabIn(prov[1], 'experimental_bearer_token');
    const mdl = prof ? grabIn(prof[1], 'model') : undefined;
    if (bu !== undefined) setBaseUrl(bu);
    if (tok !== undefined && tok.length > 0) setApiKey(tok);
    if (mdl !== undefined) setModel(mdl);
    return true;
  };

  // Claude 家族分级模型映射:仅保留有 model 或 name 的档位。
  const modelMapClean: Record<string, { model?: string; name?: string }> = {};
  if (isClaudeFamily) {
    for (const tier of ['haiku', 'sonnet', 'opus'] as const) {
      const m = modelMap[tier].model.trim();
      const n = modelMap[tier].name.trim();
      if (m || n) modelMapClean[tier] = { ...(m ? { model: m } : {}), ...(n ? { name: n } : {}) };
    }
  }

  // Codex 模型列表：过滤掉 id 为空的行。
  const codexModelsClean = clientId === 'codex' ? codexModels.filter((m) => m.id.trim().length > 0) : [];

  // 从原 settings 起改,保留 uiMeta 与其它未知键,再覆盖功能键。预览与保存共用。
  // codex 不写 routeViaProxy（主进程 codex 路径不读该键）。
  const draftSettings: Record<string, unknown> = {
    ...((profile.settings ?? {}) as Record<string, unknown>),
    ...(extra ? { [extra.key]: extraValue } : {}),
    ...(nativeProtoUi ? { upstreamProtocol } : {}),
  };
  // 路由(直连/中转)改由页面级「路由」开关决定，清除历史档残留的 routeViaProxy（不再使用）。
  delete draftSettings.routeViaProxy;
  if (isClaudeFamily) {
    if (Object.keys(modelMapClean).length > 0) draftSettings.modelMap = modelMapClean;
    else delete draftSettings.modelMap;
  }
  if (clientId === 'codex') {
    if (codexModelsClean.length > 0) draftSettings.codexModels = codexModelsClean;
    else delete draftSettings.codexModels;
  }
  // 完整 URL：开则写 true，关则删键（避免残留把老档锁在「开」态）。
  if (fullUrl) draftSettings.fullUrl = true;
  else delete draftSettings.fullUrl;

  // 进入编辑(或切换被编辑档)时,从 profile 预填。
  useEffect(() => {
    const s = (profile.settings ?? {}) as Record<string, unknown>;
    const ex = CLIENT_EXTRA_FIELD[profile.clientId];
    const proto = CLIENT_NATIVE_PROTOCOL_UI[profile.clientId];
    setName(profile.name);
    setBaseUrl(profile.baseUrl);
    setFullUrl(s.fullUrl === true);
    setApiKey('');
    setModel(profile.model ?? '');
    setExtraValue((s[ex?.key ?? ''] as string | undefined) ?? ex?.default ?? '');
    setUpstreamProtocol((s.upstreamProtocol as string | undefined) ?? proto ?? '');
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
    // Codex 模型列表：settings.codexModels 有则回填；无则用 profile.model 初始化一行（向后兼容）。
    if (profile.clientId === 'codex') {
      const raw = s.codexModels;
      if (Array.isArray(raw) && raw.length > 0) {
        const items: CodexModelItem[] = raw.map((item) => {
          if (typeof item === 'object' && item !== null) {
            const o = item as Record<string, unknown>;
            return {
              id: typeof o.id === 'string' ? o.id : '',
              name: typeof o.name === 'string' ? o.name : undefined,
              contextWindow: typeof o.contextWindow === 'number' && o.contextWindow > 0 ? o.contextWindow : undefined,
            };
          }
          return { id: '' };
        });
        setCodexModels(items);
      } else if (profile.model && profile.model.length > 0) {
        setCodexModels([{ id: profile.model }]);
      } else {
        setCodexModels([]);
      }
    } else {
      setCodexModels([]);
    }
    setModels([]);
  }, [profile]);

  const canSubmit = name.trim().length > 0 && baseUrl.trim().length > 0 && !busy;
  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    // codex：顶层 model 取列表首项 id（向后兼容卡片显示与老逻辑）；无列表则用单一 model 字段。
    const effectiveModel = clientId === 'codex' && codexModelsClean.length > 0
      ? codexModelsClean[0].id
      : model.trim() || null;
    try {
      await onSave(profile.id, {
        name: name.trim(),
        baseUrl: baseUrl.trim(),
        model: effectiveModel,
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
        {/* 请求地址 + 内联「完整 URL」药丸开关（决定是否自动补 /v1；测连通/取模型/relay/Codex 注入同源生效）。 */}
        <div>
          <div className="mb-1.5 flex items-center gap-2.5">
            <span className="text-[12px] font-medium text-muted-foreground">{t('clientConfigPage.form.baseUrl')}</span>
            <div className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1">
              <Link2 className="size-3 text-muted-foreground" aria-hidden />
              <span className="text-[11px] font-medium text-muted-foreground">{t('clientConfigPage.form.fullUrl')}</span>
              <Switch checked={fullUrl} onCheckedChange={setFullUrl} className="ml-0.5 scale-90" aria-label={t('clientConfigPage.form.fullUrl')} />
            </div>
          </div>
          <Input className="font-mono" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.example.com/v1" />
          <div className="mt-2 flex items-start gap-2 rounded-[8px] border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-700 dark:text-amber-300/90">
            <Lightbulb className="mt-px size-3.5 shrink-0" aria-hidden />
            <span className="text-[11px] leading-relaxed">{t(fullUrl ? 'clientConfigPage.form.fullUrlHintOn' : 'clientConfigPage.form.fullUrlHintOff')}</span>
          </div>
        </div>
        <label className="text-[12px] font-medium text-muted-foreground">
          {t('clientConfigPage.form.apiKey')}
          <Input className="mt-1 font-mono" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={t('clientConfigPage.form.apiKeyKeepPlaceholder')} />
        </label>

        {/* 固定协议客户端(claude/codex/gemini_cli):上游协议选择。置于模型区块之前(连接信息聚拢)。 */}
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

        {/* 单一模型字段：codex 用列表组件替代，其它客户端保留 */}
        {clientId !== 'codex' && (
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
        )}

        {isClaudeFamily && (
          <ClaudeModelMapFields
            value={modelMap}
            options={models}
            onTierChange={(tier, patch) => setModelMap((prev) => ({ ...prev, [tier]: { ...prev[tier], ...patch } }))}
          />
        )}

        {/* Codex 模型列表 + 获取按钮 */}
        {clientId === 'codex' && (
          <>
            <div className="flex items-center justify-end">
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
            <CodexModelListFields
              value={codexModels}
              options={models}
              onChange={setCodexModels}
            />
          </>
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

        {/* 协议不匹配：启用时需在列表页开启「路由」经号小管反代转换（硬门槛）。 */}
        {mismatch && (
          <p className="-mt-1 text-[11px] leading-relaxed text-amber-600 dark:text-amber-400">
            {t('clientConfigPage.form.mismatchHint')}
          </p>
        )}

        <ConfigPreview
          clientId={clientId}
          name={name}
          baseUrl={baseUrl}
          apiKey={apiKey}
          model={model}
          settings={draftSettings}
          footNote={mismatch ? t('clientConfigPage.form.previewRelayNote') : undefined}
          onApplyEdit={clientId === 'claude' ? applyClaudeConfigEdit : clientId === 'codex' ? applyCodexConfigEdit : undefined}
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
