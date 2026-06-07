// 每客户端「添加供应商」的专属模板:额外字段定义 + 少量常用预设。
// 不同 agent 表单字段不同(Codex wire_api / OpenCode npm 适配器 / OpenClaw api 协议 / Hermes api_mode);
// 预设按客户端预填 baseUrl/model/settings。模型名可由用户改;baseUrl 与协议按各客户端形态校准。
import type { ClientConfigClientId } from '@shared/api-types';

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
}

// ─── 每客户端额外字段 ───────────────────────────────────────────────────
export const CLIENT_EXTRA_FIELD: Partial<Record<ClientConfigClientId, ExtraFieldSpec>> = {
  codex: {
    key: 'wireApi',
    label: 'Wire API',
    default: 'responses',
    options: [
      { value: 'responses', label: 'Responses' },
      { value: 'chat', label: 'Chat Completions' },
    ],
  },
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

// ─── 每客户端常用预设(少量,可自行编辑) ─────────────────────────────────
// Claude Code 走各家 Anthropic 兼容端点(通常 /anthropic 子路径);
// Codex/OpenCode/OpenClaw/Hermes 走 OpenAI 兼容端点(/v1 或各自路径)。
const OPENAI_COMPAT: ProviderPreset[] = [
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { id: 'zhipu', label: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4.6' },
  { id: 'moonshot', label: 'Kimi (Moonshot)', baseUrl: 'https://api.moonshot.cn/v1', model: 'kimi-k2-0905-preview' },
  { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' },
  { id: 'siliconflow', label: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1' },
];

export const CLIENT_PRESETS: Record<ClientConfigClientId, ProviderPreset[]> = {
  claude: [
    { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/anthropic', model: 'deepseek-chat' },
    { id: 'zhipu', label: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/anthropic', model: 'glm-4.6' },
    { id: 'moonshot', label: 'Kimi (Moonshot)', baseUrl: 'https://api.moonshot.cn/anthropic', model: 'kimi-k2-0905-preview' },
    { id: 'siliconflow', label: '硅基流动', baseUrl: 'https://api.siliconflow.cn' },
  ],
  gemini_cli: [],
  codex: OPENAI_COMPAT.map((p) => ({ ...p, settings: { wireApi: 'chat' } })),
  opencode: OPENAI_COMPAT.map((p) => ({ ...p, settings: { npm: '@ai-sdk/openai-compatible' } })),
  openclaw: OPENAI_COMPAT.map((p) => ({ ...p, settings: { api: 'openai-completions' } })),
  hermes: OPENAI_COMPAT.map((p) => ({ ...p, settings: { apiMode: 'chat_completions' } })),
};
