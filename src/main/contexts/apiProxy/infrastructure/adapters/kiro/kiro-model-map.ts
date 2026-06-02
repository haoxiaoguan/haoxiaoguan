// Kiro 模型映射（纯函数，无副作用）。把客户端给的模型名归一化到 Kiro CodeWhisperer 接受的形态。
// 参考：参考实现 线协议模块 的 MODEL_ID_MAP / normalizeClaudeVersion / mapModelId（按线协议重写，不拷贝）。

// 模型 ID 映射表：客户端别名 → Kiro 接受的点号版本。default 兜底用最新 sonnet。
const MODEL_ID_MAP: Record<string, string> = {
  // Claude 4.5 系列
  'claude-sonnet-4-5': 'claude-sonnet-4.5',
  'claude-sonnet-4.5': 'claude-sonnet-4.5',
  'claude-haiku-4-5': 'claude-haiku-4.5',
  'claude-haiku-4.5': 'claude-haiku-4.5',
  'claude-opus-4-5': 'claude-opus-4.5',
  'claude-opus-4.5': 'claude-opus-4.5',
  // Claude 4 系列
  'claude-sonnet-4': 'claude-sonnet-4',
  'claude-sonnet-4-20250514': 'claude-sonnet-4',
  // Claude 3.x 兼容（旧名 → 最新对应档）
  'claude-3-5-sonnet': 'claude-sonnet-4.5',
  'claude-3-opus': 'claude-sonnet-4.5',
  'claude-3-sonnet': 'claude-sonnet-4',
  'claude-3-haiku': 'claude-haiku-4.5',
  // 非 Claude 客户端兜底（OpenAI 等模型名 → sonnet）
  'gpt-4': 'claude-sonnet-4.5',
  'gpt-4o': 'claude-sonnet-4.5',
  'gpt-4-turbo': 'claude-sonnet-4.5',
  'gpt-3.5-turbo': 'claude-sonnet-4.5',
  default: 'claude-sonnet-4.5',
}

/**
 * 归一化 Claude 版本号：把 claude-{family}-{major}-{minor} 最后一段版本短横转点号。
 * 背景：部分客户端（如 Claude Code）不允许模型名出现 '.'，会把 'claude-opus-4.6' 写成
 * 'claude-opus-4-6'，原样透传给 Kiro 会被解析成 'claude-opus-4'（丢 minor → 丢 1M 上下文）。
 * 仅当 minor 是 1~2 位数字且其后不是更多数字时转换，避免误伤日期快照（claude-sonnet-4-20250514 不动）。
 */
export function normalizeClaudeVersion(modelId: string): string {
  return modelId.replace(
    /^(claude-(?:sonnet|haiku|opus))-(\d+)-(\d{1,2})(?=$|[^\d])/i,
    '$1-$2.$3',
  )
}

// CodeWhisperer 原生模型 ID 形态：全大写字母/数字/下划线且至少含一个下划线（如 CLAUDE_SONNET_4_20250514_V1_0）。
function isCodeWhispererModelId(modelId: string): boolean {
  return /^[A-Z0-9_]+$/.test(modelId) && modelId.includes('_')
}

/**
 * 把客户端模型名映射为 Kiro 接受的模型 ID。
 * 顺序：trim → 空串兜底 → CodeWhisperer 原生 ID 透传 → 归一化版本短横 → 别名表命中 →
 *      claude-(sonnet|haiku|opus)- 前缀向前兼容透传 → 完全未知兜底 default。
 */
export function mapModelId(model: string): string {
  let modelId = model.trim()
  if (modelId.length === 0) return MODEL_ID_MAP.default
  if (isCodeWhispererModelId(modelId)) return modelId
  modelId = normalizeClaudeVersion(modelId)
  const lower = modelId.toLowerCase()
  if (MODEL_ID_MAP[lower] !== undefined) return MODEL_ID_MAP[lower]
  if (/^claude-(sonnet|haiku|opus)-/.test(lower)) return modelId
  return MODEL_ID_MAP.default
}
