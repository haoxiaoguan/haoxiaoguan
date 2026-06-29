// 添加供应商:作为右侧页面(非弹窗)。头部带返回按钮,底部取消/创建。每客户端模板不同。
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
import { ClientLogo } from './ClientLogo';
import { ProviderPresetGrid } from './ProviderPresetGrid';
import { ConfigPreview } from './ConfigPreview';
import { ModelCombobox } from './ModelCombobox';
import { ClaudeModelMapFields, EMPTY_MODEL_MAP, type ModelMap } from './ClaudeModelMapFields';
import { CodexModelListFields, type CodexModelItem } from './CodexModelListFields';
import { CLIENT_EXTRA_FIELD, CLIENT_PRESETS, CLIENT_NATIVE_PROTOCOL_UI, UPSTREAM_PROTOCOL_OPTIONS } from './provider-templates';
import type { ClientConfigClientId } from '@shared/api-types';

export interface AddProviderValue {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  // 值类型用 unknown：routeViaProxy 落库为布尔 true（后端读 settings.routeViaProxy === true）。
  settings?: Record<string, unknown>;
}

const CUSTOM = 'custom';

export function AddProviderDialog({
  clientId,
  clientName,
  onBack,
  onCreate,
}: {
  clientId: ClientConfigClientId;
  clientName: string;
  /** 返回列表。 */
  onBack: () => void;
  onCreate: (v: AddProviderValue) => Promise<void>;
}) {
  const { t } = useTranslation('nav');
  const extra = CLIENT_EXTRA_FIELD[clientId];
  const nativeProtoUi = CLIENT_NATIVE_PROTOCOL_UI[clientId];
  const presets = CLIENT_PRESETS[clientId] ?? [];
  const isClaudeFamily = clientId === 'claude' || clientId === 'claude_desktop';

  const [presetId, setPresetId] = useState(CUSTOM);
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  // 「完整 URL」：开=原样用 baseUrl(不补 /v1);关=按基址自动补 /v1(默认,兼容)。
  const [fullUrl, setFullUrl] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [extraValue, setExtraValue] = useState(extra?.default ?? '');
  const [upstreamProtocol, setUpstreamProtocol] = useState(nativeProtoUi ?? '');
  // 选中预设的品牌元数据(图标/颜色/品牌 id),提交时写进 settings.uiMeta。
  const [brand, setBrand] = useState<{ brandId?: string; icon?: string; iconColor?: string }>({});
  // Claude 家族分级模型映射(Claude Code env / Claude Desktop 3P profile)。
  const [modelMap, setModelMap] = useState<ModelMap>(EMPTY_MODEL_MAP);
  // Codex 模型列表(仅 codex 客户端使用)。
  const [codexModels, setCodexModels] = useState<CodexModelItem[]>([]);
  // 「获取模型列表」拉到的模型(供下拉)。
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

  // 协议不匹配（如 Claude 配 openai-chat、Codex 配 openai-chat 而非 openai-responses）→ 启用时必须开「路由」经反代转换。
  const mismatch = nativeProtoUi !== undefined && upstreamProtocol !== nativeProtoUi;

  // 切客户端时重置(页面常驻,clientId 变化即清空)。
  useEffect(() => {
    setPresetId(CUSTOM);
    setName('');
    setBaseUrl('');
    setFullUrl(false);
    setApiKey('');
    setModel('');
    setExtraValue(CLIENT_EXTRA_FIELD[clientId]?.default ?? '');
    setUpstreamProtocol(CLIENT_NATIVE_PROTOCOL_UI[clientId] ?? '');
    setBrand({});
    setModelMap(EMPTY_MODEL_MAP);
    setCodexModels([]);
    setModels([]);
  }, [clientId]);

  const onPickPreset = (id: string) => {
    setPresetId(id);
    if (id === CUSTOM) return;
    const p = presets.find((x) => x.id === id);
    if (!p) return;
    setName(p.label);
    setBaseUrl(p.baseUrl);
    setModel(p.model ?? '');
    setBrand({ brandId: p.brandId, icon: p.icon, iconColor: p.iconColor });
    const e = CLIENT_EXTRA_FIELD[clientId];
    if (e) setExtraValue((p.settings?.[e.key] as string | undefined) ?? e.default);
  };

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
    if (tok !== undefined && tok.length > 0) setApiKey(tok); // 空不覆盖
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

  // Claude 分级模型映射:仅保留有 model 或 name 的档位。
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

  // 写入用的功能 settings(供应商专属字段 + 固定协议客户端的上游协议 + Claude 分级映射)。预览与提交共用。
  // 路由(直连/中转)由页面级「路由」开关 + 协议匹配性决定，不再随档存 routeViaProxy。
  const draftSettings: Record<string, unknown> = {
    ...(extra ? { [extra.key]: extraValue } : {}),
    ...(nativeProtoUi ? { upstreamProtocol } : {}),
    ...(fullUrl ? { fullUrl: true } : {}),
    ...(Object.keys(modelMapClean).length > 0 ? { modelMap: modelMapClean } : {}),
    ...(clientId === 'codex' && codexModelsClean.length > 0 ? { codexModels: codexModelsClean } : {}),
  };

  const canSubmit = name.trim().length > 0 && baseUrl.trim().length > 0 && !busy;
  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    // codex：顶层 model 取列表首项 id（向后兼容卡片显示与老逻辑）；无列表则用单一 model 字段。
    const effectiveModel = clientId === 'codex' && codexModelsClean.length > 0
      ? codexModelsClean[0].id
      : model.trim();
    try {
      await onCreate({
        name: name.trim(),
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
        model: effectiveModel,
        settings: {
          ...draftSettings,
          // 品牌元数据(图标/颜色/品牌 id),供卡片展示;writer 不读此键,不写盘。
          ...(brand.brandId || brand.icon
            ? {
                uiMeta: {
                  ...(brand.brandId ? { brandId: brand.brandId } : {}),
                  ...(brand.icon ? { icon: brand.icon } : {}),
                  ...(brand.iconColor ? { iconColor: brand.iconColor } : {}),
                },
              }
            : {}),
        },
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
        <ClientLogo clientId={clientId} className="size-7" imageClassName="size-4" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold text-foreground">{t('clientConfigPage.form.createTitleFor', { client: clientName })}</div>
          <div className="truncate text-[11.5px] text-muted-foreground">{t('clientConfigPage.form.thirdPartyHint')}</div>
        </div>
      </div>

      {/* 滚动表单体 */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
        {presets.length > 0 && (
          <div>
            <div className="mb-1.5 text-[12px] font-medium text-muted-foreground">{t('clientConfigPage.form.preset')}</div>
            <ProviderPresetGrid presets={presets} value={presetId} onPick={onPickPreset} />
          </div>
        )}

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
          <Input className="mt-1 font-mono" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..." />
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

        {/* Claude 分级模型映射(可选) */}
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

        {/* 该客户端专属字段(OpenCode npm / OpenClaw api / Hermes api_mode) */}
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
          {t('clientConfigPage.form.create')}
        </Button>
      </div>
    </div>
  );
}
