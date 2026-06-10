// 每客户端「添加供应商」的专属模板:额外字段定义 + 少量常用预设。
// 不同 agent 表单字段不同(OpenCode npm 适配器 / OpenClaw api 协议 / Hermes api_mode);
// 预设按客户端预填 baseUrl/model/settings。模型名可由用户改;baseUrl 与协议按各客户端形态校准。
import type { ClientConfigClientId } from '@shared/api-types';
import { BRAND_PRESETS, brandToPreset, type DerivedBrandPreset } from './brand-presets';

// ─── 客户端原生协议 & 上游协议选项 ──────────────────────────────────────────
/** 固定协议客户端的原生协议值。flexible 客户端(opencode/openclaw/hermes)不在此表,不需要上游协议字段。 */
export const CLIENT_NATIVE_PROTOCOL_UI: Partial<Record<ClientConfigClientId, 'anthropic' | 'openai-responses' | 'gemini'>> = {
  claude: 'anthropic',
  codex: 'openai-responses',
  gemini_cli: 'gemini',
};

export interface UpstreamProtocolOption { value: string; label: string }
export const UPSTREAM_PROTOCOL_OPTIONS: UpstreamProtocolOption[] = [
  { value: 'openai-chat', label: 'OpenAI Chat Completions' },
  { value: 'openai-responses', label: 'OpenAI Responses' },
  { value: 'anthropic', label: 'Anthropic Messages' },
  { value: 'gemini', label: 'Gemini' },
];

export interface FieldOption {
  value: string;
  label: string;
}

/** 客户端专属的额外字段(下拉),其值落进 profile.settings[key]。 */
export interface ExtraFieldSpec {
  key: string;
  label: string;
  options: FieldOption[];
  default: string;
}

/** 一个预设供应商:预填表单。settings 为该客户端专属字段的预设值。 */
export interface ProviderPreset {
  id: string;
  label: string;
  baseUrl: string;
  model?: string;
  settings?: Record<string, string>;
  /** 品牌 id(写入 settings.uiMeta.brandId)。 */
  brandId?: string;
  /** 品牌图标文件名(见 ProviderBrandIcon)。 */
  icon?: string;
  /** 兜底头像底色。 */
  iconColor?: string;
}

// ─── 每客户端额外字段 ───────────────────────────────────────────────────
// Codex 无专属字段：wire_api 唯一合法值是 responses（chat 已被 Codex 移除，写入会令其整个
// config 解析失败），由写入器恒写；chat-only 上游经「上游协议」字段走号小管反代转换。
export const CLIENT_EXTRA_FIELD: Partial<Record<ClientConfigClientId, ExtraFieldSpec>> = {
  opencode: {
    key: 'npm',
    label: 'SDK 适配器',
    default: '@ai-sdk/openai-compatible',
    options: [
      { value: '@ai-sdk/openai-compatible', label: 'OpenAI Compatible' },
      { value: '@ai-sdk/openai', label: 'OpenAI Responses' },
      { value: '@ai-sdk/anthropic', label: 'Anthropic' },
      { value: '@ai-sdk/google', label: 'Google (Gemini)' },
      { value: '@ai-sdk/amazon-bedrock', label: 'Amazon Bedrock' },
    ],
  },
  openclaw: {
    key: 'api',
    label: 'API 协议',
    default: 'openai-completions',
    options: [
      { value: 'openai-completions', label: 'OpenAI Completions' },
      { value: 'openai-responses', label: 'OpenAI Responses' },
      { value: 'anthropic-messages', label: 'Anthropic Messages' },
      { value: 'google-generative-ai', label: 'Google Generative AI' },
      { value: 'bedrock-converse-stream', label: 'Bedrock Converse' },
    ],
  },
  hermes: {
    key: 'apiMode',
    label: 'API 模式',
    default: 'chat_completions',
    options: [
      { value: 'chat_completions', label: 'Chat Completions' },
      { value: 'anthropic_messages', label: 'Anthropic Messages' },
      { value: 'codex_responses', label: 'Codex Responses' },
      { value: 'bedrock_converse', label: 'Bedrock Converse' },
    ],
  },
};

// ─── 每客户端常用预设(从品牌注册表派生) ─────────────────────────────────
// claude 走各家 Anthropic 兼容端点;codex/opencode/openclaw/hermes 走 OpenAI 兼容端点。
// 每客户端注入其专属字段默认(opencode npm / openclaw api / hermes apiMode)。
function derivedToPreset(d: DerivedBrandPreset, settings?: Record<string, string>): ProviderPreset {
  return {
    id: d.brandId,
    label: d.label,
    baseUrl: d.baseUrl,
    ...(d.model ? { model: d.model } : {}),
    brandId: d.brandId,
    ...(d.icon ? { icon: d.icon } : {}),
    ...(d.iconColor ? { iconColor: d.iconColor } : {}),
    ...(settings ? { settings } : {}),
  };
}

function presetsFor(clientId: ClientConfigClientId, settings?: Record<string, string>): ProviderPreset[] {
  const out: ProviderPreset[] = [];
  for (const brand of BRAND_PRESETS) {
    const d = brandToPreset(brand, clientId);
    if (d) out.push(derivedToPreset(d, settings));
  }
  return out;
}

export const CLIENT_PRESETS: Record<ClientConfigClientId, ProviderPreset[]> = {
  claude: presetsFor('claude'),
  gemini_cli: presetsFor('gemini_cli'),
  codex: presetsFor('codex'),
  opencode: presetsFor('opencode', { npm: '@ai-sdk/openai-compatible' }),
  openclaw: presetsFor('openclaw', { api: 'openai-completions' }),
  hermes: presetsFor('hermes', { apiMode: 'chat_completions' }),
};
