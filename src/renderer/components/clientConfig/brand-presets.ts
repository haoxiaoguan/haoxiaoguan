// 品牌预设注册表:常用 AI 服务商的官方端点 + 默认模型 + 品牌图标。
// 仅用中性品牌名 + 官方公开端点,不含任何推广/affiliate 参数。
// icon 字段为 @lobehub/icons-static-svg 的文件名(不含扩展),须在 ProviderBrandIcon 的 BRAND_ICON_MAP 里登记静态 import。
import type { ClientConfigClientId } from '@shared/api-types';

export interface BrandPreset {
  /** 稳定标识(也作 settings.uiMeta.brandId)。 */
  id: string;
  /** 展示名。 */
  label: string;
  /** lobehub 图标文件名(不含 .svg);兜底首字母头像时仅用 iconColor。 */
  icon: string;
  /** 兜底头像底色(Hex)。 */
  iconColor?: string;
  /** 预填默认模型(用户可改);留空则不预填。 */
  defaultModel?: string;
  websiteUrl?: string;
  /** 端点形态:anthropic = Anthropic Messages 兼容端点;openaiCompat = OpenAI 兼容端点。 */
  endpoints: { anthropic?: string; openaiCompat?: string };
}

// ─── 常用品牌清单(~19 家,图标均已核对存在于 @lobehub/icons-static-svg) ───
export const BRAND_PRESETS: BrandPreset[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    icon: 'deepseek-color',
    iconColor: '#4D6BFE',
    defaultModel: 'deepseek-chat',
    websiteUrl: 'https://platform.deepseek.com',
    endpoints: { anthropic: 'https://api.deepseek.com/anthropic', openaiCompat: 'https://api.deepseek.com/v1' },
  },
  {
    id: 'zhipu',
    label: '智谱 GLM',
    icon: 'chatglm-color',
    iconColor: '#3859FF',
    defaultModel: 'glm-4.6',
    websiteUrl: 'https://open.bigmodel.cn',
    endpoints: { anthropic: 'https://open.bigmodel.cn/api/anthropic', openaiCompat: 'https://open.bigmodel.cn/api/paas/v4' },
  },
  {
    id: 'moonshot',
    label: 'Kimi (Moonshot)',
    icon: 'kimi-color',
    iconColor: '#000000',
    defaultModel: 'kimi-k2-0905-preview',
    websiteUrl: 'https://platform.moonshot.cn',
    endpoints: { anthropic: 'https://api.moonshot.cn/anthropic', openaiCompat: 'https://api.moonshot.cn/v1' },
  },
  {
    id: 'qwen',
    label: '通义千问 Qwen',
    icon: 'qwen-color',
    iconColor: '#615CED',
    defaultModel: 'qwen-max',
    websiteUrl: 'https://bailian.console.aliyun.com',
    endpoints: { openaiCompat: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    icon: 'minimax-color',
    iconColor: '#F23F5D',
    websiteUrl: 'https://platform.minimaxi.com',
    endpoints: { openaiCompat: 'https://api.minimaxi.com/v1' },
  },
  {
    id: 'siliconflow',
    label: '硅基流动 SiliconCloud',
    icon: 'siliconcloud-color',
    iconColor: '#6E29F6',
    websiteUrl: 'https://siliconflow.cn',
    endpoints: { openaiCompat: 'https://api.siliconflow.cn/v1' },
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    icon: 'openrouter',
    iconColor: '#6566F1',
    websiteUrl: 'https://openrouter.ai',
    endpoints: { openaiCompat: 'https://openrouter.ai/api/v1' },
  },
  {
    id: 'stepfun',
    label: '阶跃星辰 StepFun',
    icon: 'stepfun-color',
    iconColor: '#16D6D2',
    defaultModel: 'step-2-16k',
    websiteUrl: 'https://platform.stepfun.com',
    endpoints: { openaiCompat: 'https://api.stepfun.com/v1' },
  },
  {
    id: 'modelscope',
    label: '魔搭 ModelScope',
    icon: 'modelscope-color',
    iconColor: '#624AFF',
    websiteUrl: 'https://modelscope.cn',
    endpoints: { openaiCompat: 'https://api-inference.modelscope.cn/v1' },
  },
  {
    id: 'doubao',
    label: '火山方舟 豆包',
    icon: 'doubao-color',
    iconColor: '#3370FF',
    defaultModel: 'doubao-pro-32k',
    websiteUrl: 'https://www.volcengine.com/product/ark',
    endpoints: { openaiCompat: 'https://ark.cn-beijing.volces.com/api/v3' },
  },
  {
    id: 'longcat',
    label: 'LongCat',
    icon: 'longcat-color',
    iconColor: '#29E154',
    defaultModel: 'LongCat-Flash-Chat',
    websiteUrl: 'https://longcat.chat',
    endpoints: { openaiCompat: 'https://api.longcat.chat/openai/v1' },
  },
  {
    id: 'wenxin',
    label: '百度千帆 文心',
    icon: 'wenxin-color',
    iconColor: '#2932E1',
    websiteUrl: 'https://cloud.baidu.com/product/qianfan',
    endpoints: { openaiCompat: 'https://qianfan.baidubce.com/v2' },
  },
  {
    id: 'hunyuan',
    label: '腾讯混元 Hunyuan',
    icon: 'hunyuan-color',
    iconColor: '#0052D9',
    defaultModel: 'hunyuan-turbo',
    websiteUrl: 'https://cloud.tencent.com/product/hunyuan',
    endpoints: { openaiCompat: 'https://api.hunyuan.cloud.tencent.com/v1' },
  },
  {
    id: 'yi',
    label: '零一万物 Yi',
    icon: 'yi-color',
    iconColor: '#003425',
    defaultModel: 'yi-large',
    websiteUrl: 'https://platform.lingyiwanwu.com',
    endpoints: { openaiCompat: 'https://api.lingyiwanwu.com/v1' },
  },
  {
    id: 'grok',
    label: 'xAI Grok',
    icon: 'grok',
    iconColor: '#000000',
    defaultModel: 'grok-2-latest',
    websiteUrl: 'https://x.ai',
    endpoints: { openaiCompat: 'https://api.x.ai/v1' },
  },
  {
    id: 'mistral',
    label: 'Mistral',
    icon: 'mistral-color',
    iconColor: '#FA520F',
    defaultModel: 'mistral-large-latest',
    websiteUrl: 'https://mistral.ai',
    endpoints: { openaiCompat: 'https://api.mistral.ai/v1' },
  },
  {
    id: 'groq',
    label: 'Groq',
    icon: 'groq',
    iconColor: '#F55036',
    defaultModel: 'llama-3.3-70b-versatile',
    websiteUrl: 'https://groq.com',
    endpoints: { openaiCompat: 'https://api.groq.com/openai/v1' },
  },
  {
    id: 'spark',
    label: '讯飞星火 Spark',
    icon: 'spark-color',
    iconColor: '#0052D9',
    websiteUrl: 'https://xinghuo.xfyun.cn',
    endpoints: { openaiCompat: 'https://spark-api-open.xf-yun.com/v1' },
  },
  {
    id: 'together',
    label: 'Together',
    icon: 'together-color',
    iconColor: '#0F6FFF',
    websiteUrl: 'https://www.together.ai',
    endpoints: { openaiCompat: 'https://api.together.xyz/v1' },
  },
];

/** 派生预设结果:可直接预填添加/编辑表单。 */
export interface DerivedBrandPreset {
  brandId: string;
  label: string;
  baseUrl: string;
  model?: string;
  icon?: string;
  iconColor?: string;
}

/**
 * 按客户端把品牌转成可预填的预设。
 * Claude 家族走 anthropic 兼容端点;其余客户端走 openai 兼容端点。无对应端点的品牌返回 null(该客户端下不展示)。
 */
export function brandToPreset(
  brand: BrandPreset,
  clientId: ClientConfigClientId,
): DerivedBrandPreset | null {
  const baseUrl = clientId === 'claude' || clientId === 'claude_desktop' ? brand.endpoints.anthropic : brand.endpoints.openaiCompat;
  if (!baseUrl) return null;
  return {
    brandId: brand.id,
    label: brand.label,
    baseUrl,
    model: brand.defaultModel,
    icon: brand.icon,
    iconColor: brand.iconColor,
  };
}

/** 按品牌 id 取品牌(卡片回查图标用)。 */
export function getBrandById(id: string | undefined): BrandPreset | undefined {
  if (!id) return undefined;
  return BRAND_PRESETS.find((b) => b.id === id);
}
